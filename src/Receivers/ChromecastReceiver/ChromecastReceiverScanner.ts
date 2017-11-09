import DefaultMediaRemote from './Remotes/DefaultMedia';
import { deferred } from '../../ES2017/AsyncIterable';
import { GeneralRemote } from './Remotes/General';
import { Diagnostics } from '../../Diagnostics';
import { Client } from 'node-ssdp';
import * as mdns from 'multicast-dns';

export interface ChromecastReceiverIdentification {
    name : string;
    address : string;
    status : 'online' | 'offline';
}

export abstract class ChromecastReceiverScanner {
    interval : number;

    intervalToken : NodeJS.Timer = null;
    
    timeout : number;

    timeoutToken : NodeJS.Timer = null;

    pushDevice : Function;

    endDevices : Function;

    iterable : AsyncIterableIterator<ChromecastReceiverIdentification>;

    history : Map<string, ChromecastReceiverIdentification> = new Map;

    responses : Map<string, ChromecastReceiverIdentification> = new Map;

    timedOut : boolean = false;

    diagnostics : Diagnostics;

    constructor ( diagnostics : Diagnostics, interval : number = 10000, timeout : number = 5000 ) {
        this.diagnostics = diagnostics;

        this.interval = interval;

        this.timeout = timeout;

        const [ push, end, iterable ] = deferred<ChromecastReceiverIdentification>();

        this.pushDevice = push;

        this.endDevices = end;

        this.iterable = iterable;
    }

    addDevice ( name : string, address : string, status : 'online' | 'offline' = 'online' ) {
        const device = { name, address, status };

        this.history.set( address, device );
        this.responses.set( address, device );
    }

    async onResponse ( name : string, address : string ) {
        if ( !this.timedOut ) {
            const device : ChromecastReceiverIdentification = {
                name: name,
                address: address,
                status: 'online'
            };
    
            this.responses.set( address, device );

            if ( !this.history.has( address ) ) {
                this.diagnostics.debug( 'chromecast/scanner', 'new ' + name + ' ' + address );
    
                this.history.set( address, device );
    
                this.pushDevice( device );
            } else {
                this.diagnostics.debug( 'chromecast/scanner', 'duplicate ' + name + ' ' + address );
            }
        }
    }

    abstract scan ();

    onSearch () {
        this.timedOut = false;

        this.responses = new Map();

        this.scan();

        if ( typeof this.timeout === 'number' ) {
            this.timeoutToken = setTimeout( () => {
                this.timedOut = true;

                this.timeoutToken = null;
    
                for ( let ip of this.history.keys() ) {
                    if ( !this.responses.has( ip ) ) {
                        this.pushDevice( { ...this.history.get( ip ), status: 'offline' } );

                        this.diagnostics.debug( 'chromecast/scanner', 'destroy ' + this.history.get( ip ).name + ' ' + this.history.get( ip ).address );

                        this.history.delete( ip );
                    }
                }

                this.onTimeout();
            }, this.timeout );
        }
    }

    onTimeout () {}

    devices () : AsyncIterableIterator<ChromecastReceiverIdentification> {
        this.onSearch();

        if ( typeof this.interval === 'number' ) {
            this.timeoutToken = this.intervalToken = setInterval( this.onSearch.bind( this ), this.interval );
        }

        return this.iterable;    
    }

    destroy () {
        if ( this.intervalToken != null ) {
            clearInterval( this.intervalToken );

            this.intervalToken = null;
        }
        
        if ( this.timeoutToken != null ) {
            clearTimeout( this.timeoutToken );

            this.timeoutToken = null;
        }

        this.endDevices();
    }
}

export class ChromecastReceiverSSDPScanner extends ChromecastReceiverScanner {
    namespace : string = 'urn:dial-multiscreen-org:service:dial:1';

    client : Client;
    
    constructor ( diagnostics : Diagnostics, interval : number = 10000, timeout : number = 5000 ) {
        super( diagnostics, interval, timeout );

        this.client = new Client( {
            explicitSocketBind: true
        } );

        this.client.on( 'response', this.onSsdpResponse.bind( this ) );
    }

    async onSsdpResponse ( headers, statusCode, rinfo ) {
        if ( statusCode == 200 && !this.timedOut && !this.history.has( rinfo.address ) ) {
            const player = new DefaultMediaRemote( rinfo.address );
            
            await player.ensureConnection();

            // TODO Make SSDP scanner find devices' names.

            // console.log( rinfo.address, await player.callPlayerMethod( 'getStatus', [], 'status' ).catch( error => console.error( error ) ) );

            // console.log( player.name );

            this.onResponse( player.name, rinfo.address );
        }
    }

    scan () {
        this.client.search( this.namespace );
    }

    destroy () {
        super.destroy();

        this.client.stop();
    }
}

export class ChromecastReceiverMDNSScanner extends ChromecastReceiverScanner {
    interval : number;

    serviceName : string = '_googlecast._tcp.local';

    serviceType : string = 'PTR';
    
    mdns : any;

    onResponseHandler : Function = null;

    constructor ( diagnostics : Diagnostics, interval : number = 10000, timeout : number = 5000 ) {
        super( diagnostics, interval, timeout );

        this.onResponseHandler = this.onMdnsResponse.bind( this );
    }

    async onMdnsResponse ( packet, rinfo ) {
        const answer = packet.answers[ 0 ];

        if ( !answer || ( answer.name !== this.serviceName || answer.type !== this.serviceType ) ) {
            return;
        }
    
        const info = packet.additionals.find( entry => entry.type === 'A' );
        const txt = packet.additionals.find( entry => entry.type === 'TXT' );

        if ( !info || !txt ) {
            return;
        }

        const name = txt.data.toString( 'utf8' ).split( '\x07' )[ 0 ].split( 'fn=' )[ 1 ];

        if ( !name ) {
            return;
        }

        this.onResponse( name, rinfo.address );
    }

    async scan () : Promise<void> {
        this.mdns = mdns( {
            multicast: true
        } );

        this.mdns.on( 'response', this.onResponseHandler );

        this.mdns.query( this.serviceName, this.serviceType );
    }

    onTimeout () {
        if ( this.mdns ) {
            this.mdns.removeListener( 'response', this.onResponseHandler );
            
            this.mdns.destroy();
    
            this.mdns = null;
        }
    }

    destroy () {
        super.destroy();

        this.onTimeout();
    }
}
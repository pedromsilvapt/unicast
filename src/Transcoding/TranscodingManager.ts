import { DriverFactory } from "./DriverFactory";
import { TranscodingDriver } from "./TranscodingDriver";
import { MediaStream } from "../MediaProviders/MediaStreams/MediaStream";
import { UnicastServer } from "../UnicastServer";

export class TranscodingManager {
    server : UnicastServer;

    drivers : Map<string, DriverFactory<any>[]> = new Map();

    defaultDrivers : Map<string, string> = new Map();

    constructor ( server : UnicastServer ) {
        this.server = server;
    }

    getDriverFor<D> ( type : string, name : string = null ) : D {
        if ( !this.drivers.has( type ) ) {
            throw new Error( `Could not find drivers for media type "${ type }"` );
        }

        const drivers = this.drivers.get( type );

        if ( drivers.length === 0 ) {
            throw new Error( `Could not find drivers for media type "${ type }"` );
        }

        if ( !name ) {
            if ( this.defaultDrivers.has( type ) ) {
                name = this.defaultDrivers.get( type );
            } else {
                name = drivers[ 0 ].name;
            }
        }

        const factory = drivers.find( driver => driver.name === name );

        if ( !factory ) {
            throw new Error( `Could not find a driver named "${ name }".` );
        }

        return factory.create( this.server );
    }

    registerDriver ( factory : DriverFactory<any>, setAsDefault : boolean = false ) : this {
        if ( !this.drivers.has( factory.type ) ) {
            this.drivers.set( factory.type, [] );
        }

        this.drivers.get( factory.type ).push( factory );

        if ( setAsDefault ) {
            this.setDefaultDriverFor( factory.type, factory.name );
        }

        return this;
    }

    setDefaultDriverFor ( type : string, name : string ) : this {
        this.defaultDrivers.set( type, name );

        return this;
    }
}

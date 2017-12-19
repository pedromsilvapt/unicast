import { MediaRecord, TvEpisodeMediaRecord, MovieMediaRecord, MediaKind } from "./MediaRecord";
import { QueryBuilder, Filter } from 'array-filter-query-builder';
import * as fs from 'mz/fs';
import { UnicastServer } from "./UnicastServer";

export class TriggerDb {
    server : UnicastServer;
    
    constructor ( server : UnicastServer ) {
        this.server = server;
    }

    async load () : Promise<MediaTrigger[]> {
        const diagnostics = this.server.diagnostics;

        const dbPath = this.server.storage.getPath( 'triggerdb.json' );

        if ( !( await fs.exists( dbPath ) ) ) {
            diagnostics.info( 'triggerdb', 'No db file found. Loading empty.' );

            return [];
        } else {
            let triggers : MediaTrigger[];

            try {
                triggers = JSON.parse( await fs.readFile( dbPath, { encoding: 'utf8' } ) );
            } catch ( error ) {
                diagnostics.error( 'triggerdb', 'Could not load the json database file', { error } );
    
                return [];
            }

            for ( let trigger of triggers ) {
                for ( let timestamp of trigger.timestamps ) {
                    timestamp.start = timeFromString( timestamp.start );
                    timestamp.end = timeFromString( timestamp.end );
                }
            }

            return triggers;
        }
    }

    async query ( query : QueryBuilder ) : Promise<MediaTrigger[]> {
        const filter = new Filter();
        
        const items = await this.load();

        return filter.run( items, query );
    }

    async queryMediaRecord ( record : MediaRecord, query ?: QueryBuilder ) : Promise<MediaTrigger[]> {
        query = query ? query.clone() : new QueryBuilder();

        query.add( [ [ 'id', 'is', record.id ] ] );
        query.add( [ [ 'kind', 'is', record.kind ] ] );

        return this.query( query );
    }
}

export interface MediaTrigger {
    id : string;
    kind : MediaKind;
    category : [ string, number ];
    description ?: string;
    timestamps : TriggerTimeWindow[];
    tags ?: string[];
}

export interface TriggerTimeWindow {
    start : number;
    end : number;
    type ?: 'none' | 'blur' | 'lightblur' | 'heavyblur' | 'black';
    mute ?: boolean;
}

export function timeFromString ( input : number | string ) : number {
    if ( typeof input === 'string' ) {
        let decimal : number = 0;

        if ( input.includes( '.' ) ) {
            let decimalInput : string;

            [ input, decimalInput ] = input.split( '.' );

            decimal = parseFloat( '0.' + decimalInput);
        }

        if ( /^[0-9]+$/.test( input ) ) {
            const seconds = parseInt( input );

            return parseInt( input ) + decimal;
        } else if ( /^[0-9]+:[0-9]+$/.test( input ) ) {
            const [ minutes, seconds ] = input.split( ':' );

            return ( parseInt( minutes ) * 60 ) + parseInt( seconds ) + decimal;
        } else if ( /^[0-9]+:[0-9]+:[0-9]+$/.test( input ) ) {
            const [ hours, minutes, seconds ] = input.split( ':' );
            
            return ( parseInt( hours ) * 60 * 60 ) + ( parseInt( minutes ) * 60 ) + parseInt( seconds ) + decimal;
        }

        return NaN;
    } else {
        return input;
    }
}
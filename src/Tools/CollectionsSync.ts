import { Tool, ToolOption, ToolValueType } from "./Tool";
import { groupingByMany, collect, first, groupingBy } from 'data-collectors';
import { AbstractMediaTable, Database, MediaTable } from '../Database/Database';
import { AsyncStream } from 'data-async-iterators';
import { ExternalReferences, MediaRecord, MediaKind } from '../MediaRecord';
import chalk from 'chalk';

export interface CollectionsSyncOptions {
    target : string;
    dryRun : boolean;
    onlyCollections: boolean;
}

export class CollectionsSyncTool extends Tool<CollectionsSyncOptions> {
    getParameters () {
        return [
            new ToolOption( 'target' ).setRequired( true ),
        ];
    }

    getOptions () {
        return [
            new ToolOption( 'dryRun' ).setType( ToolValueType.Boolean ).setDefaultValue( false ).setRequired( false ),
            new ToolOption( 'onlyCollections' ).setType( ToolValueType.Boolean ).setDefaultValue( false ).setRequired( false )
        ];
    }

    async syncCollections ( sourcedb : Database, targetdb : Database, options : CollectionsSyncOptions ) : Promise<void> {
        const sync = new Synchronizer(
            await sourcedb.tables.collections.findStream().toArray(),
            await targetdb.tables.collections.findStream().toArray(),
            col => [ col.title ],
            col => [ col.title ]
        );

        const logger = this.logger;

        const result = await sync.sync( {
            async doAdded ( added ) {
                for ( let collection of added ) {
                    logger.info( chalk.cyan( 'CREATE ' ) + collection.title );
                    
                    if ( !options.dryRun ) {
                        await targetdb.tables.collections.create( without( collection, 'id', 'parentId' ) );
                    }
                }
            },
            async doRemoved ( removed ) {
                for ( let collection of removed ) {
                    logger.info( chalk.red( 'REMOVE ' ) + collection.title );
                    
                    if ( !options.dryRun ) {
                        await targetdb.tables.collections.delete( collection.id );

                        await targetdb.tables.collectionsMedia.deleteMany( q => q.where( { collectionId: collection.id } ) );
                    }
                }
            },
            async doMatched ( matched ) {
                for ( let [ source, target ] of matched ) {
                    if ( targetdb.tables.collections.isChanged( target, without( source, 'id', 'parentId' ) ) ) {
                        logger.info( chalk.green( 'UPDATE ' ) + source.title );
    
                        if ( !options.dryRun ) {
                            await targetdb.tables.collections.updateIfChanged( target, without( source, 'id', 'parentId' ) );
                        }
                    }
                }
            },
        } );

        this.log( `COLLECTIONS: ${result.added.length} added, ${result.matched.length} updated, ${result.removed.length} removed.` );

        sync.targets = await targetdb.tables.collections.findStream().toArray();

        await sync.syncSelfRelations( "id", [ "parentId" ], async ( records ) => {
            for ( let [ target, patch ] of records ) {
                if ( targetdb.tables.collections.isChanged( target, patch ) ) {
                    logger.info( chalk.green( 'UPDATE REL ' ) + target.title );

                    if ( !options.dryRun ) {
                        await targetdb.tables.collections.updateIfChanged( target, patch );
                    }
                }
            }
        } );
    }

    async syncCollectionsMedia ( sourcedb : Database, targetdb : Database, options : CollectionsSyncOptions ) : Promise<void> {
        const sourceTable = await sourcedb.tables.collectionsMedia;
        const sourceMedia = await sourceTable.relations.collection.applyAll(
            await sourceTable.relations.record.applyAll( 
                await sourceTable.findStream().toArray() 
            )
        );

        const targetTable = targetdb.tables.collectionsMedia;
        const targetMedia = await targetTable.relations.collection.applyAll(
            await targetTable.relations.record.applyAll( 
                await targetTable.findStream().toArray() 
            )
        );
        
        const externalKeys = ( external : ExternalReferences, prefix : string = '', sep : string = '-' ) : string[] => {
            return Object.keys( external ).map( key => prefix + key + sep + external[ key ] );
        }

        const externalCollectionsTable = await targetdb.tables.collections.findStream()
            .collect( groupingBy( col => col.title, first() ) );

        const externalRecordsTable = await AsyncStream
            .from<AbstractMediaTable<MediaRecord>>( [ targetdb.tables.movies, targetdb.tables.shows ] )
            .flatMap( t => t.findStream() )
            .collect( groupingBy( rec => rec.kind, groupingByMany( rec => externalKeys( rec.external ) ) ) );

        const sync = new Synchronizer(
            sourceMedia, targetMedia,
            col => col.record && col.collection ? externalKeys( col.record.external, col.collection.title ) : [],
            col => col.record && col.collection ? externalKeys( col.record.external, col.collection.title ) : []
        );

        const matchRecords = ( record : MediaRecord ) : MediaRecord[] => {
            if ( record && externalRecordsTable.has( record.kind ) ) {
                for ( let key of Object.keys( record.external ) ) {
                    const reference = key + '-' + record.external[ key ];

                    return externalRecordsTable.get( record.kind ).get( reference ) || [] ;
                }
            }

            return [];
        };

        const logger = this.logger;

        const result = await sync.sync( {
            async doAdded ( added ) {
                for ( let collection of added ) {
                    if ( !collection.collection || !collection.record ) {
                        logger.fatal( `Dangling Record: ${ collection.mediaKind } ${ collection.mediaId }, Collection: ${collection.collectionId}` );
                        continue;
                    }

                    for ( let record of matchRecords( collection.record ) ) {
                        logger.info( chalk.cyan( 'CREATE ' ) + record.kind + ' ' + record.title + chalk.grey( ' in ' ) + collection.collection.title );

                        if ( !options.dryRun ) {
                            await targetdb.tables.collectionsMedia.create( {
                                collectionId: externalCollectionsTable.get( collection.collection.title ).id,
                                createdAt: collection.createdAt,
                                mediaId: record.id,
                                mediaKind: record.kind
                            } );
                        }
                    }
                }
            },
            async doRemoved ( removed ) {
                for ( let collection of removed ) {
                    if ( !collection.collection || !collection.record ) {
                        logger.fatal( `Dangling Record: ${ collection.mediaKind } ${ collection.mediaId }, Collection: ${collection.collectionId}` );
                        continue;
                    }

                    for ( let record of matchRecords( collection.record ) ) {

                        logger.info( chalk.red( 'REMOVE ' ) + record.kind + ' ' + record.title + chalk.grey( ' in ' ) + collection.collection.title );

                        if ( !options.dryRun ) {
                            await targetdb.tables.collectionsMedia.deleteMany( q => q.where( {
                                collectionId: externalCollectionsTable.get( collection.collection.title ).id,
                                mediaId: record.id,
                                mediaKind: record.kind
                            } ) );
                        }
                    }
                }
            },
            async doMatched ( matched ) {
                // for ( let [ source, target ] of matched ) {
                //     if ( !options.dryRun ) {
                //         await targetdb.tables.collections.updateIfChanged( target, without( source, 'id' ) );
                //     }
                // }
            },
        } );

        this.log( `COLLECTIONS MEDIA: ${result.added.length} added, ${result.matched.length} updated, ${result.removed.length} removed.` );
    }

    async run ( options : CollectionsSyncOptions ) {
        const sourcedb = this.server.database;
        const targetdb = this.server.database.for( options.target );
        
        await sourcedb.install();
        await targetdb.install();
        
        await this.syncCollections( sourcedb, targetdb, options );

        if ( !options.onlyCollections ) {
            await this.syncCollectionsMedia( sourcedb, targetdb, options );
        }
    }
}

function without<T> ( obj : T, ...keys : string[] ) : T {
    const cloned = { ...obj };
    
    for ( let key of keys ) delete cloned[ key ];

    return cloned;
}

export class Synchronizer<S, K, T> {
    sources : S[];

    targets : T[];

    getSourceKeys : ( source : S ) => K[];

    getTargetKeys : ( source : T ) => K[];

    public constructor ( sources : S[], targets : T[], getSourceKeys : ( source : S ) => K[], getTargetKeys : ( source : T ) => K[] ) {
        this.sources = sources;
        this.targets = targets;
        this.getSourceKeys = getSourceKeys;
        this.getTargetKeys = getTargetKeys;
    }

    match () : SyncResult<S, T> {
        const result : SyncResult<S, T> = { added: [], matched: [], removed: [] };

        const sourceTable = collect( this.sources, groupingByMany( source => this.getSourceKeys( source ) ) );

        const touched : Set<S> = new Set();
        
        const removed : Set<T> = new Set();

        for ( let target of this.targets ) {
            let found = false;

            for ( let key of this.getTargetKeys( target ) ) {
                if ( sourceTable.has( key ) ) {
                    const matchedSources = sourceTable.get( key );
                    
                    matchedSources.forEach( source => touched.add( source ) );

                    result.matched.push( ...matchedSources.map( source => [ source, target ] as [ S, T ] ) );

                    found = true;

                    break;
                }
            }

            if ( !found && !removed.has( target ) ) {
                result.removed.push( target );

                removed.add( target );
            }
        }

        for ( let source of this.sources ) {
            if ( !touched.has( source ) ) result.added.push( source );
        }

        return result;
    }

    async sync ( methods : { doAdded ?: ( added : S[] ) => Promise<void>, doMatched ?: ( matches : [S, T][] ) => Promise<void>, doRemoved ?: ( removed : T[] ) => Promise<void> } ) : Promise<SyncResult<S, T>> {
        const result = this.match();

        if ( methods.doAdded ) await methods.doAdded( result.added );
        if ( methods.doMatched ) await methods.doMatched( result.matched );
        if ( methods.doRemoved ) await methods.doRemoved( result.removed );

        return result;
    }

    /**
     * Should be called after the sync method, assumes both datasets are already synchronized.
     * The `targets` field should however be updated with the latest data from the database
     * 
     * @param fieldNames 
     */
    async syncSelfRelations<F extends keyof S & keyof T> ( pk : F, fieldNames : F[], doUpdated : (records: [T, Partial<T>][]) => Promise<unknown> ) {
        const sourceTable = collect( this.sources, groupingByMany( source => this.getSourceKeys( source ) ) );

        const sourcePKTable = collect( this.sources, groupingBy( source => source[ pk ], first() ) );
        
        const targetTable = collect( this.targets, groupingByMany( target => this.getTargetKeys( target ) ) );

        const updated : [T, Partial<T>][] = [];

        for ( let target of this.targets ) {
            // Here we're only taking the first match and ignoring the rest
            const matchedSource : S = mapFind( this.getTargetKeys( target ), key => ( sourceTable.get( key ) || [] )[ 0 ] );

            if ( matchedSource == null ) continue;
            
            let patch : Partial<S | T> = {};

            for ( let fieldName of fieldNames ) {
                const fieldValue : S[F] = matchedSource[ fieldName ];

                if ( fieldValue === null || fieldValue === void 0 ) continue;

                const fieldMatch : S = sourcePKTable.get( fieldValue );

                const fieldMatchTarget : T = mapFind( this.getSourceKeys( fieldMatch ), key => ( targetTable.get( key ) || [] )[ 0 ] );

                if ( fieldMatchTarget != null ) {
                    patch[ fieldName ] = fieldMatchTarget[ pk ];
                }
            }

            if ( Object.keys( patch ).length > 0 ) {
                updated.push( [ target, patch as Partial<T> ] );
            }
        }

        if ( updated.length > 0 ) {
            await doUpdated( updated );
        }
    }
}

function notNull ( elem: unknown ) : boolean {
    return elem !== null && elem !== void 0;
}

function mapFind<T, U> ( arr: T[], mapper: (elem: T, index: number) => U, predicate: (elem: U, index: number) => boolean = notNull ) : U {
    if ( arr != null ) {
        for ( let [index, elem] of arr.entries() ) {
            const mappedElem = mapper(elem, index);
    
            if ( predicate( mappedElem, index ) ) {
                return mappedElem;
            }
        }
    }

    return null;
}

export interface SyncResult<S, T> {
    added: S[];
    matched: [S, T][];
    removed: T[];
}

import { CollectionRecord } from '../../../Database/Database';
import { isPlayableRecord, MediaExternalMap, MediaKind, MediaRecord, PlayableQualityRecord } from '../../../MediaRecord';
import { SmartCollection } from '../../../SmartCollections/SmartCollection';

export class DuplicatedMediaCollection extends SmartCollection {
    public constructor () {
        super( 'duplicated-media' );
    }
    
    public async update ( collection: CollectionRecord, options: Options ) : Promise<void> {
        if ( collection == null || typeof collection.id !== 'string' ) {
            throw new Error( `Invalid collection passed to Duplicated Media Smart Collection.` );
        }

        var mediaItems: MediaRecord[] = [];

        for ( const kind of options.kinds ?? [] ) {
            const table = this.server.media.getTable( kind );
            
            var map = new MediaExternalMap();

            for await ( const record of table.findStream() ) {
                if ( options.excludedQualities != null && isPlayableRecord( record ) ) {
                    let skip = false;

                    for ( const qualityKey of Object.keys( record.quality ) ) {
                        const excluded = options.excludedQualities[ qualityKey ] as string[];

                        if ( excluded != null && excluded.includes( record.quality[ qualityKey ] ) ) {
                            skip = true;
                            break;
                        }
                    }

                    if ( skip ) continue;
                }

                map.addAll( record.external, record );
            }

            var repeatedIds = new Set<string>();

            for ( const records of map.values() ) {
                if ( records.length <= 1 ) {
                    continue;
                }

                for ( const record of records ) {
                    if ( !repeatedIds.has( record.id ) ) {
                        repeatedIds.add( record.id );

                        mediaItems.push( record );
                    }
                }
            }
        }

        await this.server.media.syncCollection( collection.id, mediaItems );
    }
}

export interface Options {
    kinds: MediaKind[];
    excludedQualities?: {
        [P in keyof PlayableQualityRecord]?: PlayableQualityRecord[P][]
    }
}

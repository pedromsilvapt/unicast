import { Converters, FieldConverters } from '../Converters';
import { MediaKind, AbstractMediaTable, PlayableMediaRecord, PlayableMediaRecordSql } from './AbstractMediaTable';

export class CustomMediaTable extends AbstractMediaTable<CustomMediaRecord> {
    readonly tableName : string = 'mediaCustom';

    readonly kind : MediaKind = MediaKind.Custom;

    dateFields = [ 'addedAt', 'lastPlayedAt' ];

    fieldConverters: FieldConverters<CustomMediaRecord, CustomMediaRecordSql> = {
        id: Converters.id(),
        sources: Converters.json(),
        metadata: Converters.json(),
        external: Converters.json(),
        art: Converters.json(),
        repositoryPaths: Converters.json(),
        watched: Converters.bool(),
        transient: Converters.bool(),
        addedAt: Converters.date(),
        createdAt: Converters.date(),
        updatedAt: Converters.date(),
        lastPlayedAt: Converters.date(),
        lastPlayedAtLegacy: Converters.json(),
    };
}

export interface CustomMediaRecord extends PlayableMediaRecord {
    kind: MediaKind.Custom;
    subtitle ?: string;
    plot ?: string;
}

export interface CustomMediaRecordSql extends PlayableMediaRecordSql {

}

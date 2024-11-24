import { Knex } from 'knex';
import { Hook } from '../../Hookable';
import { Relation } from '../Relations/Relation';
import { DotNode, Relatable, expandDotStrings, tableChainDeep } from '../RelationGraph';
import type { Database, DatabaseTables } from '../Database';
import { AsyncStream, map, toArray } from 'data-async-iterators';
import * as equals from 'fast-deep-equal';
import { Converters, FieldConverters } from '../Converters';
import * as Case from 'case';

export abstract class BaseTable<R extends BaseRecord> implements Relatable<R> {
    abstract readonly tableName : string;

    readonly timestamped : boolean = true;

    connection : Knex;

    dateFields : string[] = [];

    relations : Record<string, Relation<R, any>> = {};

    onCreate : Hook<R> = new Hook( 'onCreate' );

    onUpdate : Hook<R> = new Hook( 'onUpdate' );

    onDelete : Hook<R> = new Hook( 'onDelete' );

    changesHistoryEnabled : boolean = false;

    changesHistory : ChangeHistoryTable<R>;

    identifierFields : Array<string> = null;

    fieldConverters : FieldConverters<R, any> = {} as any;

    columns: Record<string | number | symbol, Knex.ColumnInfo>;

    columnNames: Set<string>;

    readonly database : Database;

    constructor ( database : Database ) {
        this.database = database;
        this.connection = database.connection;
    }

    query ( options: QueryOptions | null = null ) : Knex.QueryBuilder {
        let query = this.connection.queryBuilder().table( this.tableName );

        if (options?.transaction != null) {
            query = query.transacting( options.transaction );
        }

        return query;
    }

    async install () {
        this.relations = this.installRelations( this.database.tables );

        if ( this.changesHistoryEnabled && this.changesHistory != null ) {
            this.changesHistory = new ChangeHistoryTable( this.database, this.tableName + 'History' );

            this.onCreate.subscribe( record => this.changesHistory.createChange( 'create', record ) );
            this.onUpdate.subscribe( record => this.changesHistory.createChange( 'update', record ) );
            this.onDelete.subscribe( record => this.changesHistory.createChange( 'delete', record ) );
        }

        if ( this.changesHistoryEnabled ) {
            await this.changesHistory.install();
        }

        this.columns = await this.connection.table( this.tableName ).columnInfo();
        this.columnNames = new Set( Object.keys( this.columns ) );
    }

    installRelations ( tables : DatabaseTables ) {
        return {};
    }

    tableChainDeep ( children: DotNode[] ) : Relation<any, any>[] {
        return tableChainDeep( this, children );
    }

    // createRelationsQuery ( ...relations : string[] ) : RelationsQuery<R, this> {
    //     return new RelationsQuery( this, this.tableChainDeep( expandDotStrings( relations ) ) );
    // }

    protected serialize ( record : R ) : object {
        const result = {} as object;

        for ( const key of Object.keys( record ) ) {
            if ( key in this.fieldConverters ) {
                result[ key ] = this.fieldConverters[ key ].serialize( record[ key ] );
            } else if ( key in this.columns ) {
                // Ignore keys that are not columns in the tables
                result[ key ] = record[ key ];
            }
        }

        return result;
    }

    protected serializeMany ( record : R[] ) : object {
        return record.map( v => this.serialize( v ) );
    }

    protected deserialize ( record : object ) : R {
        const result = { ...record } as R;

        for ( const key of Object.keys( this.fieldConverters ) ) {
            if ( key in record ) {
                result[ key ] = this.fieldConverters[ key ].deserialize( record[ key ] );
            }
        }

        return result;
    }

    protected deserializeMany ( record : object[] ) : R[] {
        return record.map( v => this.deserialize( v ) );
    }

    async tryGet ( id : string, options : QueryOptions = null ) : Promise<R | null> {
        if ( !id ) {
            return null;
        }

        const record = await this.query( options ).where( 'id', id ).limit( 1 ).first();

        if ( record == null ) {
            return null;
        }

        return this.deserialize( record );
    }

    async get ( id : string, options : QueryOptions = null ) : Promise<R> {
        const row = this.tryGet( id, options );

        if ( row == null ) {
            throw new RowNotFound(id, this.tableName);
        }

        return row;
    }

    async has ( id : string, options : QueryOptions = null ) : Promise<boolean> {
        return ( await this.query( options ).where( 'id', id ).count() ) > 0;
    }

    async findAll ( keys : any[], options : FindAllQueryOptions = {} ) : Promise<R[]> {
        if ( keys.some( key => key === void 0 ) ) {
            keys = keys.filter( key => key !== void 0 );
        }

        if ( keys.length === 0 ) {
            return [];
        }

        let query = this.query( options ).whereIn( options.column ?? 'id', keys );

        if ( options.query ) {
            query = options.query( query );
        }

        const result = this.deserializeMany( await query );

        return result;
    }

    async run<T> ( query ?: ( query : Knex.QueryBuilder ) => Knex.QueryBuilder, options : QueryOptions = null ) : Promise<T> {
        return await query( this.query( options ) );
    }

    async find<T = R> ( query ?: ( query : Knex.QueryBuilder ) => Knex.QueryBuilder, options : QueryOptions = null ) : Promise<T[]> {
        return toArray( this.findStream<T>( query, options ) );
    }

    protected findStreamIterator<T = R> ( query ?: ( query : Knex.QueryBuilder ) => Knex.QueryBuilder, options : QueryOptions = null ) : AsyncIterable<T> {
        let sequence : Knex.QueryBuilder = this.query( options );

        if ( query ) {
            sequence = query( sequence );
        }

        if ( this.database.config.get<boolean>( 'database.debug' ) ) {
            this.database.knexLogger.debug( sequence.toSQL() );
        }

        return sequence.stream();
    }

    findStream<T = R> ( query ?: ( query : Knex.QueryBuilder ) => Knex.QueryBuilder, options : QueryOptions = null ) : AsyncStream<T> {
        return AsyncStream.dynamic( () => this.findStreamIterator( query, options ) )
            .map( record => this.deserialize( record ) as any as T );
    }

    async findOne<T = R> ( query ?: ( query : Knex.QueryBuilder ) => Knex.QueryBuilder, options : QueryOptions = null ) : Promise<T> {
        const results = await this.find<T>( subQuery => query ? query( subQuery ).limit( 1 ) : subQuery.limit( 1 ), options );

        return results[ 0 ];
    }

    async count ( query ?: ( query : Knex.QueryBuilder ) => Knex.QueryBuilder, options : QueryOptions = null ) : Promise<number> {
        return this.run( sequence => {
            if ( query != null ) {
                sequence = query( sequence );
            }

            return sequence.count();
        }, options );
    }

    public raw ( expr : string ) : Knex.Raw {
        return this.database.connection.raw( expr );
    }

    async queryDistinctJson<V = any>( column: string, jsonPath : string, options : DistinctJsonQueryOptions = null ) : Promise<V[]> {
        let query: Knex.QueryBuilder = this.query( options )
            .distinct()
            .select(this.raw(`json_extract(${ column }, '${ jsonPath }') AS value`))
            .whereRaw(`json_extract(${ column }, '${ jsonPath }') IS NOT NULL`);

        if ( options?.orderBy != null ) {
            query = query.orderBy( 'value', options.orderBy );
        }

        if ( options?.query != null ) {
            query = options.query.apply( query, query );
        }

        const results = await query;

        return results.map( row => row.value );
    }

    async queryDistinctJsonArray<V = any>( column: string, jsonPath : string = '$', options : DistinctJsonQueryOptions = null ) : Promise<V[]> {
        let query = this.query( options )
            .distinct()
            .select(this.raw(`__jsonArrayTable.value AS value`))
            .fromRaw(`${this.tableName}, json_each(${ column }, '${ jsonPath }') __jsonArrayTable`);

        if ( options?.orderBy != null ) {
            query = query.orderBy( 'value', options.orderBy );
        }

        if ( options?.query != null ) {
            query = options.query.apply( query, query );
        }

        const results = await query;

        return results.map( row => row.value );
    }

    public getIdentifier ( record : R ) : string {
        if ( this.identifierFields == null || this.identifierFields.length == 0 ) {
            return null;
        }

        let identifier = '';

        for ( const field of this.identifierFields ) {
            identifier += '' + record[ field ];
        }

        if ( identifier.length > 0 ) {
            // Remove from the string anything that is invalid as an identifier:
            //  - every character at the start that is not [a-zA-Z_]
            //  - every character anywhere that is not [\w]
            return Case.pascal( identifier.replace(/(^[^a-zA-Z_])|[^\w]+/g, '-') );
        }

        return null;
    }

    public applyIdentifier ( record: R, clone: boolean = false ) : R {
        const identifier = this.getIdentifier( record );

        if ( identifier != null && identifier != record[ 'identifier' ] ) {
            // If requested, clone the source object before making any changes to it
            if ( clone ) {
                record = { ...record };
            }

            record[ 'identifier' ] = identifier;
        }

        return record;
    }

    public isTimestamped( records : R[] ) : records is ( R & TimestampedRecord )[];
    public isTimestamped( record : R ) : record is ( R & TimestampedRecord );
    public isTimestamped( _ : R | R[] ) : boolean {
        return this.timestamped;
    }

    public prepare ( record : R, action : 'create' | 'update' ) : any {
        this.applyIdentifier( record );

        if ( this.isTimestamped( record ) ) {
            const now = new Date();

            if ( action == 'create' && record.createdAt == null ) {
                record.createdAt = now;
            }

            if ( action == 'update' || record.updatedAt == null ) {
                record.updatedAt = now;
            }
        }

        return this.serialize( record );
    }

    async create ( record : R, options : QueryOptions = null ) : Promise<R> {

        const res = await this.query( options ).insert( this.prepare( record, 'create' ), [ 'id' ] );

        record.id = res[ 0 ].id;

        this.onCreate.notify( record );

        return record;
    }

    async createMany ( recordsIter : Iterable<R>, options : QueryOptions = null ) : Promise<R[]> {
        const records: R[] = recordsIter instanceof Array
            ? recordsIter
            : Array.from( recordsIter );

        if ( records.length === 0 ) {
            return [];
        }

        var chunkSize = Math.floor( 500 / ( Object.keys( records[ 0 ] ).length ) );

        for ( const chunkRecords of chunk( records, chunkSize ) ) {
            const res = await this.query( options ).insert( chunkRecords.map( r => this.prepare( r, 'create' ) ), [ 'id' ] );

            let index = 0;

            for ( let record of chunkRecords ) {
                if ( !record.id ) {
                    record.id = res[ index++ ].id;
                }
            }
        }

        for ( const record of records ) {
            this.onCreate.notify( record );
        }

        return records;
    }

    async update ( id : string, record : Knex.QueryCallback | any, options : Partial<QueryOptions> = {} ) : Promise<R> {
        if ( record[ "id" ] != void 0 && id != record[ "id" ] ) {
            this.database.server.logger.error( 'database/' + this.tableName, 'TRYING TO CHANGE ID FFS OF RECORD ' + JSON.stringify( { ...record, id } ) + ' TO ' + record[ "id" ] );

            delete record[ "id" ];
        }

        let updateCallback = typeof record === 'function'
            ? record
            : q => q.update( this.prepare( record, 'update' ) );


        await updateCallback( this.query( options )
            .where( 'id', id ) );

        if ( this.onUpdate.isSubscribed() ) {
            this.get( id, options ).then( updated => this.onUpdate.notify( updated ) );
        }

        return record;
    }

    getLocalChanges ( baseRecord : object, changes : object ) : string[] {
        return Object.keys( changes ).filter( key => !equals( baseRecord[ key ], changes[ key ] ) );
    }

    isChanged ( baseRecord : object, changes : object ) : boolean {
        const baseRecordSerialized = this.serialize( baseRecord as R );
        const changesSerialized = this.serialize( changes as R );

        return Object.keys( changesSerialized ).some( key => !equals( baseRecordSerialized[ key ], changesSerialized[ key ] ) );
    }

    async updateIfChanged ( baseRecord : object, changes : object, conditionalChanges : object = null, options : QueryOptions = {} ) : Promise<R> {
        if ( this.isChanged( baseRecord, changes ) ) {
            if ( conditionalChanges && typeof conditionalChanges == 'object' ) {
                changes = { ...changes, ...conditionalChanges };
            }

            if ( changes[ "id" ] != void 0 && baseRecord[ "id" ] != changes[ "id" ] ) {
                this.database.server.logger.error( 'database/' + this.tableName, 'TRYING TO CHANGE ID FFS OF RECORD ' + JSON.stringify( baseRecord ) + ' TO ' + changes[ "id" ] );

                delete changes[ "id" ];
            }

            await this.update( baseRecord[ "id" ], changes, options );
        }

        return baseRecord as R;
    }

    async updateMany ( query : ( query : Knex.QueryBuilder ) => Knex.QueryBuilder, update : Knex.QueryCallback | any, limit : number = Infinity, options : QueryOptions = {} ) : Promise<number> {
        let queryBuilder = query( this.query( options ) );

        if ( limit && limit < Infinity ) {
            queryBuilder = queryBuilder.limit( limit );
        }

        let updatedCount = 0;

        let updateCallback = typeof update === 'function'
            ? update
            : q => q.update( this.prepare( update, 'update' ) );


        if ( this.onUpdate.isSubscribed() ) {
            const ids : number[] = await queryBuilder
                .select( 'id' )
                .then( records => records.map( r => r.id ) );

            updatedCount = await updateCallback( this.query( options )
                .whereIn( 'id', ids ) );

            this.query( options ).whereIn( 'id', ids )
                .then( async records => {
                    for ( let record of records ) {
                        await this.onUpdate.notify( this.deserialize( record ) );
                    }
                } );
        } else {
            updatedCount = await updateCallback( queryBuilder );
        }

        return updatedCount;
    }

    async delete ( id : string, options : QueryOptions = {} ) : Promise<boolean> {
        let record : R = null;

        if ( this.onDelete.isSubscribed() ) {
            record = await this.get( id, options );
        }

        const deletedCount = await this.query( options ).where( 'id', id ).delete();

        if ( record != null ) {
            this.onDelete.notify( record );
        }

        return deletedCount > 0;
    }

    async deleteKeys ( keys : any[], options : DeleteKeysQueryOptions = {} ) : Promise<number> {
        if ( keys.length === 0 ) {
            return 0;
        }

        const primaryKey = 'id';
        const column = options.index || primaryKey;
        let keysSerialized = keys;
        if ( column in this.fieldConverters ) {
            const columnConverter = this.fieldConverters[ column ];
            keysSerialized = keys.map( value => columnConverter.serialize( value ) );
        }

        let table = this.query( options ).whereIn( column, keysSerialized );

        if ( options.query ) {
            table = options.query( table );
        }

        let deletedCount = 0;

        if ( this.onDelete.isSubscribed() ) {
            const records : R[] = this.deserializeMany( await table );

            const primaryKeys : any[] = column == primaryKey
                ? keys
                : records.map( r => r[ primaryKey ] )

            deletedCount = await this.query( options ).where( primaryKey, primaryKeys ).delete();

            Promise.resolve( records ).then( async records => {
                for ( let record of records ) {
                    await this.onDelete.notify( record );
                }
            } );
        } else {
            deletedCount = await table.delete();
        }

        return deletedCount;
    }

    async deleteMany ( predicate ?: ( query : Knex.QueryBuilder ) => Knex.QueryBuilder, limit : number = Infinity, options : QueryOptions = {} ) : Promise<number> {
        let query = predicate != null
            ? predicate( this.query( options ) )
            : this.query( options );

        if ( limit && limit < Infinity ) {
            query = query.limit( limit );
        }

        let deletedCount : number = 0;

        if ( this.onDelete.isSubscribed() ) {
            const records : R[] = this.deserializeMany( await query );

            const ids : string[] = records.map( r => this.fieldConverters[ 'id' ].serialize( r.id as any ) )

            deletedCount = await this.query( options ).whereIn( 'id', ids ).delete();

            Promise.resolve( records ).then( async records => {
                for ( let record of records ) {
                    await this.onDelete.notify( record );
                }
            } );
        } else {
            deletedCount = await query.delete();
        }

        return deletedCount;
    }

    async deleteAll ( limit : number = Infinity, options : QueryOptions = {} ) : Promise<number> {
        let query = this.query( options );

        if ( limit != Infinity && typeof limit === 'number' ) {
            query = query.limit( limit );
        }

        return await query.delete();
    }

    async repair ( records : string[] = null ) {

    }
}


export function * chunk<T> ( iterable : Iterable<T>, chunkSize : number ) {
    let hasNext = true;

    const iter = iterable[ Symbol.iterator ]();

    try {
        while ( hasNext ) {
            const chunk: T[] = [];

            while ( chunk.length < chunkSize ) {
                const { done, value } = iter.next();

                if ( done ) {
                    hasNext = false;
                    break;
                } else {
                    chunk.push( value );
                }
            }

            if ( chunk.length > 0 ) {
                yield chunk;
            }
        }
    } finally {
        iter.return?.();
    }
}

export interface BaseRecord {
    id ?: string;
}

export interface TimestampedRecord {
    createdAt ?: Date;
    updatedAt ?: Date;
}

export interface BaseRecordSql {
    id ?: number;
}

export interface TimestampedRecordSql {
    createdAt : number;
    updatedAt : number;
}

export interface EntityRecord extends BaseRecord, TimestampedRecord {
    internalId : string;
    scraper : string;
    external : ExternalReferences;
}

export interface EntityRecordSql extends BaseRecordSql, TimestampedRecordSql {
    external : string;
}

export type ExternalReferences = {
    imdb ?: string;
    tvdb ?: string;
    [ key : string ] : string
};

export class ChangeHistoryTable<R extends BaseRecord> extends BaseTable<ChangeHistory<R>> {
    tableName: string;

    // indexesSchema: IndexSchema[] = [
    //     { name: 'dataId', expression: r.row( 'data' )( 'id' ) },
    //     { name: 'createdAt' }
    // ];

    fieldConverters: FieldConverters<ChangeHistory<R>, ChangeHistorySql> = {
        id: Converters.id(),
        dataId: Converters.id(),
        data: Converters.json(),
        changedAt: Converters.date(),
    };

    public constructor ( database : Database, tableName: string ) {
        super( database );

        this.tableName = tableName;
    }

    public async createChange ( action: 'create' | 'update' | 'delete', data: R, date?: Date ): Promise<ChangeHistory<R>> {
        const now = date ?? new Date();

        const change: ChangeHistory<R> = {
            action: action,
            dataId: data.id,
            data: data,
            changedAt: now,
        };

        return await this.create( change );
    }

    public async createManyChanges ( action: 'create' | 'update' | 'delete', datas: R[] ): Promise<ChangeHistory<R>[]> {
        const now = new Date();

        const changes: ChangeHistory<R>[] = datas.map( data => ({
            action: action,
            dataId: data.id,
            data: data,
            changedAt: now,
        }));

        return await this.createMany( changes );
    }

    public async getForRecord ( id : string, action ?: 'create' | 'update' | 'delete' ) : Promise<ChangeHistory<R>[]> {
        return this.findAll( [ id ], {
            column: 'dataId',
            query: query => action ? query.where( 'action', action ) : query,
        } );
    }
}

export interface QueryOptions {
    transaction ?: Knex.Transaction | null;
}

export interface FindAllQueryOptions extends QueryOptions {
    column ?: string;
    query ?: ( query : Knex.QueryBuilder ) => Knex.QueryBuilder;
}

export interface DeleteKeysQueryOptions extends QueryOptions {
    index ?: string;
    query ?: ( query : Knex.QueryBuilder ) => Knex.QueryBuilder;
}

export interface DistinctJsonQueryOptions extends QueryOptions {
    orderBy ?: 'asc' | 'desc' | null | undefined;
    query ?: Knex.QueryCallback;
}

export interface ChangeHistory<R> {
    id ?: string;
    action : 'create' | 'update' | 'delete';
    dataId : string;
    data : R;
    changedAt : Date;
}

export interface ChangeHistorySql {
    id : number;
    dataId : number;
    data : string;
    changedAt : number;
}

export class RowNotFound extends Error {
    constructor (id: string, tableName: string) {
        super(`No record with id "${id}" found in table ${tableName}`);
    }
}

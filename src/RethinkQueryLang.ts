
import * as r from 'rethinkdb';
import { Database } from  './Database/Database';
import { BinaryOperator, CompiledQuery, InvalidOpError, PropertySemantics, QueryAst, QueryLang, QuerySemantics, UnaryOperator } from './QueryLang';
import * as Case from "case";

function toIdentifier ( value: string ) {
    // Remove from the string anything that is invalid as an identifier:
    //  - every character at the start that is not [a-zA-Z_]
    //  - every character anywhere that is not [\w]
    return Case.pascal( value.replace(/(^[^a-zA-Z_])|[^\w]+/g, '-') )
}

export abstract class RethinkRelationCompiler {
    protected identifiers: string[] = null;

    protected aliases: Map<string, string[]> = null;

    protected lookupSemantics: QuerySemantics = null;

    public propertySemantics: PropertySemantics<r.Expression<unknown>> = null;

    public name : string;

    public constructor ( name : string ) {
        this.name = name;
    }

    public async createAliasesMap ( identifiers : string[] ): Promise<Map<string, string[]>> {
        var aliases = new Map<string, string[]>();

        // Identifier indicating if a record matches a given identifier
        let match = null;

        // Variable to hold the Primary Keys associated with a given alias
        let ids: string[] = null;

        var identifiersSet = new Set( identifiers );

        for await ( const recordKeys of await this.list() ) {
            const primaryKey = recordKeys[ 0 ];

            for ( const key of recordKeys ) {
                if ( identifiersSet.has( key ) ) {
                    match = key;
                } else {
                    const token = toIdentifier( key );

                    if ( identifiersSet.has( token ) ) {
                        match = token;
                    }
                }

                if ( match != null ) {
                    ids = aliases.get( match );

                    if ( ids == null ) {
                        aliases.set( match, ids = [ primaryKey ] );
                    } else if ( !ids.includes( primaryKey ) ) {
                        ids.push( primaryKey );
                    }
                    
                    match = null;
                }
            }
        }

        return aliases;
    }

    abstract list (): AsyncIterable<string[]>;

    abstract join ( query : r.Sequence ): r.Sequence;

    abstract filter ( query : r.Expression<unknown>, id : string | string[] ): r.Expression<unknown>;

    public async analyze ( query : QueryAst ) {
        const rightHandSides: QueryAst[] = [];

        QueryLang.visit( query, node => {
            if ( node.kind == 'binaryOperator' 
            && ( node.op == BinaryOperator.EqualTo || node.op == BinaryOperator.NotEqualTo ) ) {
                var lhs = node.lhs;

                if ( lhs.kind == 'identifier' && lhs.name === this.name ) {
                    rightHandSides.push( node.rhs );
                }
            }
        } )

        const identifiers = new Set<string>();

        for ( const rhs of rightHandSides ) {
            QueryLang.visit( rhs, node => {
                if ( node.kind == 'identifier' && !identifiers.has( node.name ) ) {
                    identifiers.add( node.name );
                }
            } );
        }
        
        this.identifiers = Array.from( identifiers );

        if ( this.identifiers.length > 0 ) {
            this.aliases = await this.createAliasesMap( this.identifiers );
        } else {
            this.aliases = new Map();
        }

        this.lookupSemantics = this.createLookupSemantics();

        this.propertySemantics = this.createSemantics();
    }

    public createLookupSemantics (): QuerySemantics<r.Expression<unknown>> {
        const semantics = new QuerySemantics<r.Expression<unknown>>();

        for ( const identifier of this.identifiers ) {
            const ids = this.aliases.get( identifier );

            semantics.properties[ identifier ] = QuerySemantics.computed( 
                ( doc : any ) => this.filter( doc, ids ?? identifier )
            );
        }
        
        return semantics;
    }

    public createSemantics (): PropertySemantics<r.Expression<unknown>> {
        const propertySemantics = new PropertySemantics<r.Expression<unknown>>();
        
        propertySemantics.binaryOperators[ BinaryOperator.EqualTo ] = ( lhsAst, _, rhsAst, semantics ) => {
            // TODO Inherit semantics
            const rhs = RethinkLang.compile( rhsAst, this.lookupSemantics ) as any;
    
            return ( doc : r.Expression<unknown> ) : r.Expression<unknown> => {
                return rhs( doc );
            };
        };

        propertySemantics.binaryOperators[ BinaryOperator.NotEqualTo ] = ( lhsAst, _, rhsAst, semantics ) => {
            // TODO Inherit semantics
            const rhs = RethinkLang.compile( rhsAst, this.lookupSemantics ) as any;
    
            return ( doc : r.Expression<unknown> ) : r.Expression<unknown> => {
                return rhs( doc ).not();
            };
        };
    
        return propertySemantics;
    }
}

export class CollectionsRelationCompiler extends RethinkRelationCompiler  {
    public database : Database;

    constructor ( database : Database ) {
        super( 'collection' );

        this.database = database;
    }

    public async * list () {
        // Re-use the array to avoid unnecessary allocations.
        const array: string[] = [null, null];

        for await ( const collection of await this.database.tables.collections.findStream() ) {
            array[0] = collection.id;
            array[1] = collection.title;

            yield array;
        }
    }
    
    join ( query : r.Sequence ) : r.Sequence {
        if ( this.identifiers.length === 0 ) {
            return query;
        }

        return ( query as any ).merge( ( record ) => {
            const collections = ( this.database.tables.collectionsMedia.query()
                .getAll( [ record( 'kind' ), record( 'id' ) ] as any, { index: 'reference' } )
                .map( pivot => pivot( 'collectionId' ) ) as any ).coerceTo( 'array' )

            return { collections };
        } );
    }

    filter ( doc: r.Expression<unknown>, identifier: string | string[] ): r.Expression<unknown> {
        const expr = typeof identifier === 'string'
            ? r.expr( [ identifier ] )
            : r.expr( identifier );
        
        return ( doc( "collections" ) as any ).setIntersection( expr ).isEmpty().not();
    }
}

export class CastRelationCompiler extends RethinkRelationCompiler  {
    public database : Database;

    constructor ( database : Database ) {
        super( 'cast' );

        this.database = database;
    }

    public async * list () {
        // Re-use the array to avoid unnecessary allocations.
        const array: string[] = [null, null];
        
        for ( const person of await this.database.tables.people.findAll( this.identifiers, { index: 'identifier' }  ) ) {
            array[0] = person.id;
            array[1] = person.name;
            
            yield array;
        }
    }
    
    join ( query : r.Sequence ) : r.Sequence {
        if ( this.identifiers.length === 0 ) {
            return query;
        }

        const useIdentifiers = this.identifiers.length < 30;

        return ( query as any ).merge( ( record ) => {
            let cast: any;

            // TODO: Think of a more efficient way to perform this query, in cases where the identifiers
            // are few. In such cases, just retrieve the Ids of the identifiers, so in the query after
            // we can just filter by those Ids, instead of having to perform a join for each record by id
            // and compare the identifiers there
            
            // if ( useIdentifiers ) {
            //     const ids = this.identifiers
            //         .flatMap( id => this.aliases.get( id ) ?? [ id ] );

            //     cast = ( this.database.tables.mediaCast.query()
            //         .getAll( ( r as any ).args( ids ), { index: 'personId' } )
            //         .filter( { mediaKind: record( 'kind' ), mediaId: record( 'id' ) } )
            //         .map( pivot => pivot( 'personId' ) ) as any ).coerceTo( 'array' )
            // } else {
                cast = ( this.database.tables.mediaCast.query()
                    .getAll( [ record( 'kind' ), record( 'id' ) ] as any, { index: 'reference' } )
                    .map( pivot => pivot( 'personId' ) ) as any ).coerceTo( 'array' )
            // }

            return { cast };
        } );
    }

    filter ( doc: r.Expression<unknown>, identifier: string | string[] ): r.Expression<unknown> {
        const expr = typeof identifier === 'string'
            ? r.expr( [ identifier ] )
            : r.expr( identifier );
        
        return ( doc( "cast" ) as any ).setIntersection( expr ).isEmpty().not();
    }
}

export class GenresRelationCompiler extends RethinkRelationCompiler  {
    public database : Database;

    constructor ( database : Database ) {
        super( 'genre' );

        this.database = database;
    }

    public async * list () {
        // Re-use the array to avoid unnecessary allocations.
        const array: string[] = [null];
        
        const genres = this.database.tables.movies.findStream<string>( query => {
            return ( query as any ).distinct( { index: 'genres' } );
        } );
        
        for await ( const genreName of await genres ) {
            array[0] = genreName;
            
            yield array;
        }
    }
    
    join ( query : r.Sequence ) : r.Sequence {
        return query;
    }

    filter ( doc: r.Expression<unknown>, identifier: string | string[] ): r.Expression<unknown> {
        const expr = typeof identifier === 'string'
            ? r.expr( [ identifier ] )
            : r.expr( identifier );
        
        return ( doc( "genres" ) as any ).setIntersection( expr ).isEmpty().not();
    }
}

export class RethinkLang {
    public ast : QueryAst;

    public database : Database;

    public relations : Map<string, RethinkRelationCompiler> = new Map();

    public constructor ( database: Database, query: string | QueryAst ) {
        if ( typeof query === 'string' ) {
            query = QueryLang.parse( query );
        }

        this.ast = query;
        this.database = database;

        this.addRelation( new CollectionsRelationCompiler( this.database ) );
        this.addRelation( new GenresRelationCompiler( this.database ) );
        this.addRelation( new CastRelationCompiler( this.database ) );
        // TODO Implement Repository Relation Compiler
        // relations.set('collection', new RepositoriesRelationCompiler());
    }

    public addRelation ( relation : RethinkRelationCompiler ) {
        this.relations.set( relation.name, relation );
    }

    public async analyze () : Promise<void> {
        for ( let relation of this.relations.values() ) {
            await relation.analyze( this.ast );
        }
    }

    public compile (): (query: r.Sequence) => r.Sequence {
        // Create the query semantics where each relation is associated to it's property
        const semantics = new QuerySemantics();

        for ( const relation of this.relations.values() ) {
            semantics.properties[ relation.name ] = relation.propertySemantics;
        }
        
        // Compile the filter
        const compiledQuery = RethinkLang.compile( this.ast, semantics );

        return ( query : r.Sequence ) => {
            // Make any joins that the relation may need
            for ( let relation of this.relations.values() ) {
                query = relation.join( query );
            }

            return query.filter( compiledQuery )
        };
    }

    public async analyzeAndCompile (): Promise<(query: r.Sequence) => r.Sequence> {
        await this.analyze();

        return this.compile();
    }

    public static compile ( query : QueryAst, semantics ?: QuerySemantics<r.Expression<unknown>> ) {
        semantics = semantics ?? new QuerySemantics<r.Expression<unknown>>();
        
        if ( query.kind === 'binaryOperator' ) {
            let customSemantics = semantics.getPropertyBinaryOperatorFor( query );

            if ( customSemantics != null ) {
                return customSemantics( query.lhs, query.op, query.rhs, semantics );
            }

            const lhs = RethinkLang.compile( query.lhs, semantics );
            const rhs = RethinkLang.compile( query.rhs, semantics );

            if ( query.op === BinaryOperator.Plus ) {
                return ( c ) => (lhs( c ) as any).add( rhs( c ) as any );
            } else if ( query.op === BinaryOperator.Minus ) {
                return ( c ) => (lhs( c ) as any).sub( rhs( c ) as any );
            } else if ( query.op === BinaryOperator.Mul ) {
                return ( c ) => (lhs( c ) as any).mul( rhs( c ) as any );
            } else if ( query.op === BinaryOperator.Div ) {
                return ( c ) => (lhs( c ) as any).div( rhs( c ) as any );
            } else if ( query.op === BinaryOperator.EqualTo ) {
                return ( c ) => (lhs( c ) as any).eq( rhs( c ) );
            } else if ( query.op === BinaryOperator.NotEqualTo ) {
                return ( c ) => (lhs( c ) as any).ne( rhs( c ) );
            } else if ( query.op === BinaryOperator.LessThanEqualTo ) {
                return ( c ) => (lhs( c ) as any).le( rhs( c ) );
            } else if ( query.op === BinaryOperator.LessThan ) {
                return ( c ) => (lhs( c ) as any).lt( rhs( c ) );
            } else if ( query.op === BinaryOperator.GreaterThanEqualTo ) {
                return ( c ) => (lhs( c ) as any).ge( rhs( c ) );
            } else if ( query.op === BinaryOperator.GreaterThan ) {
                return ( c ) => (lhs( c ) as any).gt( rhs( c ) );
            } else if ( query.op === BinaryOperator.Implies ) {
                return ( c ) => (lhs( c ) as any).not().or( rhs( c ) );
            } else if ( query.op === BinaryOperator.And ) {
                return ( c ) => (lhs( c ) as any).and( rhs( c ) );
            } else if ( query.op === BinaryOperator.Or ) {
                return ( c ) => (lhs( c ) as any).or( rhs( c ) );
            } else {
                throw new InvalidOpError( query.kind, query.op );
            }
        } else if ( query.kind === 'unaryOperator' ) {
            const rhs = RethinkLang.compile( query.rhs, semantics );

            if ( query.op === UnaryOperator.Not ) {
                return ( c ) => (rhs( c ) as any).not();
            }
        } else if ( query.kind === 'identifier' ) {
            const name = query.name;

            const customSemantics = semantics.getPropertyFor( query );
            
            if ( customSemantics?.lookup != null ) {
                return customSemantics.lookup( name, semantics );
            } else if ( name.includes( '.' ) ) {
                var segments = name.split('.');

                return ( c ) => {
                    var ret = c;

                    for (const seg of segments) {
                        ret = ret(seg);
                    }

                    return ret;
                };
            } else {
                return ( c ) => c( name );
            }
        } else if ( query.kind === 'literal' ) {
            const value = query.value;

            return ( _ ) => r.expr(value);
        }

        return null;
    }
}

export class MediaRecordRethinkCompiler extends RethinkLang {
    
}

export type RethinkCompiledQuery = ( query: r.Sequence ) => r.Sequence;

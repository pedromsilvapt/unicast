
// import { Knex } from 'knex';
import { Database } from  './Database/Database';
import { BinaryOperator, CompiledQuery, InvalidOpError, PropertySemantics, QueryAst, QueryLang, QuerySemantics, UnaryOperator } from './QueryLang';
import { SqlExpression } from './ES2017/SqlExpression';
import * as Case from "case";

function toIdentifier ( value: string ) {
    // Remove from the string anything that is invalid as an identifier:
    //  - every character at the start that is not [a-zA-Z_]
    //  - every character anywhere that is not [\w]
    return Case.pascal( value.replace(/(^[^a-zA-Z_])|[^\w]+/g, '-') )
}

export abstract class SqlRelationCompiler {
    protected identifiers: string[] = null;

    protected lookupSemantics: QuerySemantics<SqlExpression, SqlExpression> = null;

    public propertySemantics: PropertySemantics<SqlExpression, SqlExpression> = null;

    public name : string;
    
    public sourceTableName : string;

    public constructor ( name : string, sourceTableName : string ) {
        this.name = name;
        this.sourceTableName = sourceTableName;
    }

    abstract filter ( identifier: string ): SqlCompiledQuery;

    public analyze ( query : QueryAst ) {
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

        this.lookupSemantics = this.createLookupSemantics();

        this.propertySemantics = this.createSemantics();
    }

    public createLookupSemantics (): QuerySemantics<SqlExpression, SqlExpression> {
        const semantics = new QuerySemantics<SqlExpression, SqlExpression>();

        for ( const identifier of this.identifiers ) {
            const query = this.filter( identifier );

            semantics.properties[ identifier ] = QuerySemantics.computed<SqlExpression, SqlExpression>( query );
        }

        return semantics;
    }

    public createSemantics (): PropertySemantics<SqlExpression, SqlExpression> {
        const propertySemantics = new PropertySemantics<SqlExpression, SqlExpression>();

        propertySemantics.binaryOperators[ BinaryOperator.EqualTo ] = ( lhsAst, _, rhsAst, semantics ) => {
            // TODO Inherit semantics
            const rhs = SqlLang.compile( rhsAst, this.lookupSemantics );

            return ( c : SqlExpression ) : SqlExpression => {
                return rhs( c );
            };
        };

        propertySemantics.binaryOperators[ BinaryOperator.NotEqualTo ] = ( lhsAst, _, rhsAst, semantics ) => {
            // TODO Inherit semantics
            const rhs = SqlLang.compile( rhsAst, this.lookupSemantics );

            return ( c : SqlExpression ) : SqlExpression => {
                return rhs( c ).not();
            };
        };

        return propertySemantics;
    }
}

export class CollectionsRelationCompiler extends SqlRelationCompiler  {
    constructor ( sourceTableName : string ) {
        super( 'collection', sourceTableName );
    }

    filter ( identifier: string ) : SqlCompiledQuery {
        var templateSql = `EXISTS (
            SELECT __cm.id
            FROM collectionMedia __cm
            INNER JOIN collections __c
                ON __c.id = __cm.collectionId
            WHERE __cm.mediaId = ${ this.sourceTableName }.id AND
                  __cm.mediaKind = ${ this.sourceTableName }.kind AND
                  (__c.identifier = '$id' OR __c.title = '$id')
            )`;

        const templateAst = SqlExpression.parse(templateSql, {
            '$id': SqlExpression.string( identifier )
        });

        return _ => templateAst;
    }
}

export class CastRelationCompiler extends SqlRelationCompiler  {
    constructor ( sourceTableName : string ) {
        super( 'cast', sourceTableName );
    }
    
    filter ( identifier: string ) : SqlCompiledQuery {
        var templateSql = `EXISTS (
            SELECT __mc.id
            FROM mediaCast __mc
            INNER JOIN people __p
                ON __p.id = __mc.personId
            WHERE __mc.mediaId = ${ this.sourceTableName }.id AND
                  __mc.mediaKind = ${ this.sourceTableName }.kind AND
                  (__p.identifier = '$id' OR __p.name = '$id')
            )`;

        const templateAst = SqlExpression.parse(templateSql, {
            '$id': SqlExpression.string( identifier )
        });

        return _ => templateAst;
    }
}

export class GenresRelationCompiler extends SqlRelationCompiler  {
    constructor ( sourceTableName : string ) {
        super( 'genre', sourceTableName );
    }
    
    filter ( identifier: string ) : SqlCompiledQuery {
        var templateSql = `EXISTS (
            SELECT __g.value
            FROM json_each(${ this.sourceTableName }.genres) __g
            WHERE __g.value = '$id'
            )`;

        const templateAst = SqlExpression.parse(templateSql, {
            '$id': SqlExpression.string( identifier ),
            '$from': SqlExpression.function( 'json_each', [ SqlExpression.ref( ['genres'], this.sourceTableName ) ] )
        });

        return _ => templateAst;
    }
}

export class SqlLang {
    public ast : QueryAst;

    public database : Database;

    public relations : Map<string, SqlRelationCompiler> = new Map();

    public constructor ( database: Database, sourceTableName : string,  query: string | QueryAst ) {
        if ( typeof query === 'string' ) {
            query = QueryLang.parse( query );
        }

        this.ast = query;
        this.database = database;

        this.addRelation( new CollectionsRelationCompiler( sourceTableName ) );
        this.addRelation( new GenresRelationCompiler( sourceTableName ) );
        this.addRelation( new CastRelationCompiler( sourceTableName ) );
        // TODO Implement Repository Relation Compiler
        // relations.set('collection', new RepositoriesRelationCompiler());
    }

    public addRelation ( relation : SqlRelationCompiler ) {
        this.relations.set( relation.name, relation );
    }

    public analyze () : void {
        for ( let relation of this.relations.values() ) {
            relation.analyze( this.ast );
        }
    }

    public compile (): SqlCompiledQuery {
        // Create the query semantics where each relation is associated to it's property
        const semantics = new QuerySemantics<SqlExpression, SqlExpression>();

        for ( const relation of this.relations.values() ) {
            semantics.properties[ relation.name ] = relation.propertySemantics;
        }

        return SqlLang.compile( this.ast, semantics );
    }

    public analyzeAndCompile (): SqlCompiledQuery {
        this.analyze();

        return this.compile();
    }

    public static compile ( query : QueryAst, semantics ?: QuerySemantics<SqlExpression, SqlExpression> ) : SqlCompiledQuery {
        semantics = semantics ?? new QuerySemantics<SqlExpression, SqlExpression>();

        if ( query.kind === 'binaryOperator' ) {
            let customSemantics = semantics.getPropertyBinaryOperatorFor( query );

            if ( customSemantics != null ) {
                return customSemantics( query.lhs, query.op, query.rhs, semantics );
            }

            const lhs = SqlLang.compile( query.lhs, semantics );
            const rhs = SqlLang.compile( query.rhs, semantics );

            if ( query.op === BinaryOperator.Plus ) {
                return ( c ) => lhs( c ).plus( rhs( c ) );
            } else if ( query.op === BinaryOperator.Minus ) {
                return ( c ) => lhs( c ).minus( rhs( c ) );
            } else if ( query.op === BinaryOperator.Mul ) {
                return ( c ) => lhs( c ).mult( rhs( c ) );
            } else if ( query.op === BinaryOperator.Div ) {
                return ( c ) => lhs( c ).div( rhs( c ) );
            } else if ( query.op === BinaryOperator.EqualTo ) {
                return ( c ) => lhs( c ).equals( rhs( c ) );
            } else if ( query.op === BinaryOperator.NotEqualTo ) {
                return ( c ) => lhs( c ).notEquals( rhs( c ) );
            } else if ( query.op === BinaryOperator.LessThanEqualTo ) {
                return ( c ) => lhs( c ).lessThanEqualTo( rhs( c ) );
            } else if ( query.op === BinaryOperator.LessThan ) {
                return ( c ) => lhs( c ).lessThan( rhs( c ) );
            } else if ( query.op === BinaryOperator.GreaterThanEqualTo ) {
                return ( c ) => lhs( c ).greaterThanEqualTo( rhs( c ) );
            } else if ( query.op === BinaryOperator.GreaterThan ) {
                return ( c ) => lhs( c ).greaterThan( rhs( c ) );
            } else if ( query.op === BinaryOperator.Implies ) {
                return ( c ) => lhs( c ).not().or( rhs( c ) );
            } else if ( query.op === BinaryOperator.And ) {
                return ( c ) => lhs( c ).and( rhs( c ) );
            } else if ( query.op === BinaryOperator.Or ) {
                return ( c ) => lhs( c ).or( rhs( c ) );
            } else {
                throw new InvalidOpError( query.kind, query.op );
            }
        } else if ( query.kind === 'unaryOperator' ) {
            const rhs = SqlLang.compile( query.rhs, semantics );

            if ( query.op === UnaryOperator.Not ) {
                return ( c ) => rhs( c ).not();
            }
        } else if ( query.kind === 'identifier' ) {
            const name = query.name;

            const customSemantics = semantics.getPropertyFor( query );

            if ( customSemantics?.lookup != null ) {
                return customSemantics.lookup( name, semantics );
            } else if ( name.includes( '.' ) ) {
                var segments = name.split('.');

                return _ => SqlExpression.ref( segments );
            } else {
                return _ => SqlExpression.ref( [ name ] );
            }
        } else if ( query.kind === 'literal' ) {
            const value = query.value;

            return _ => SqlExpression.literal( value );
        }

        return null;
    }
}

export class MediaRecordSqlCompiler extends SqlLang {

}

export type SqlCompiledQuery = CompiledQuery<SqlExpression, SqlExpression>;

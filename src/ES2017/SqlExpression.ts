import * as sql from 'node-sql-parser';

const parser = new sql.Parser();

export class SqlExpression {
    public ast : sql.Expr;
    public bindings : any[];
    
    public constructor ( source : sql.Expr, bindings : any[] = [] ) {
        this.ast = source;
        this.bindings = bindings;
    }
    
    public toSQL () : string {
        const select = {
            type: "select",
            columns: [ {
                expr: {
                    type: "number",
                    value: 1
                }
            } ],
            where: this.ast
        };
        
        return parser.sqlify( select ).slice( 'SELECT 1 WHERE '.length );
    }
    
    public binaryOperator ( op : sql.BinaryOperator, expr : SqlExpression ) : SqlExpression {
        return new SqlExpression( {
            type: 'binary_expr',
            operator: op,
            left: this.ast,
            right: expr.ast,
            parentheses: true
        } as sql.Expr );
    }
    
    
    public unaryOperator ( op : sql.UnaryOperator ) : SqlExpression {
        return new SqlExpression( {
            type: 'unary_expr',
            operator: op,
            expr: this.ast,
        } as any );
    }
    
    
    public and ( expr : SqlExpression ) : SqlExpression {
        return this.binaryOperator( 'AND', expr );
    }
    
    public or ( expr : SqlExpression ) : SqlExpression {
        return this.binaryOperator( 'OR', expr );
    }
    
    public plus ( expr : SqlExpression ) : SqlExpression {
        return this.binaryOperator( '+', expr );
    }
    
    public minus ( expr : SqlExpression ) : SqlExpression {
        return this.binaryOperator( '-', expr );
    }
    
    public mult ( expr : SqlExpression ) : SqlExpression {
        return this.binaryOperator( '*', expr );
    }
    
    public div ( expr : SqlExpression ) : SqlExpression {
        return this.binaryOperator( '/', expr );
    }
    
    public equals ( expr : SqlExpression ) : SqlExpression {
        return this.binaryOperator( '=', expr );
    }
    
    public notEquals ( expr : SqlExpression ) : SqlExpression {
        return this.binaryOperator( '!=', expr );
    }
    
    public lessThanEqualTo ( expr : SqlExpression ) : SqlExpression {
        return this.binaryOperator( '<=', expr );
    }
    
    public lessThan ( expr : SqlExpression ) : SqlExpression {
        return this.binaryOperator( '<', expr );
    }
    
    public greaterThanEqualTo ( expr : SqlExpression ) : SqlExpression {
        return this.binaryOperator( '>=', expr );
    }
    
    public greaterThan ( expr : SqlExpression ) : SqlExpression {
        return this.binaryOperator( '>', expr );
    }
    
    public not () : SqlExpression {
        return this.unaryOperator( 'NOT' );
    }
    
    public static parse ( source : string, substitutions : Record<string, SqlExpression>, entry : string = 'function' ) : SqlExpression {
        const root = ( parser.astify( `SELECT 1 WHERE ${ source }`, { database: 'Postgresql' } ) as any ).where;
        
        // create a mapper
        const mapper = astMapper( {
            single_quote_string: expr => {
                if ( expr.value in substitutions ) {
                    return substitutions[ expr.value ].ast;
                } else {
                    return mapper( expr, true );
                }
            }
        });
        
        return new SqlExpression( mapper( root ) );
    }
    
    public static ref ( name : string[], table : string = null ) : SqlExpression {
        let node = new SqlExpression( {
            type: 'column_ref',
            column: name[ 0 ],
            table: table,
        } as any );
        
        if ( name.length > 1 ) {
            node = SqlExpression.function( 'json_extract', [ node, SqlExpression.string( `$.` + name.slice( 1 ).join( '.' ) ) ] )
        }
        
        return node;
    }
    
    
    public static function ( name : string, args : SqlExpression[] = [] ) : SqlExpression {
        let node: sql.Expr = {
            type: 'function',
            name: name,
            args: {
                type: 'expr_list',
                value: args.map( arg => arg.ast )
            }
        } as any;
        
        return new SqlExpression( node );
    }
    
    public static group ( expr : SqlExpression ) : SqlExpression {
        throw new Error(`Not yet implemented`);
    }
    
    public static literal ( value : SqlLiteral ) : SqlExpression {
        if ( typeof value === 'string' ) {
            return SqlExpression.string( value );
        } else if ( typeof value === 'number' ) {
            return SqlExpression.number( value );
        } else if ( typeof value === 'boolean' ) {
            return SqlExpression.boolean( value );
        } else if ( value instanceof Date ) {
            return SqlExpression.date( value );
        } else if ( value instanceof Array ) {
            return SqlExpression.array( value );
        } else if ( value == null ) {
            return SqlExpression.null();
        } else {
            throw new Error( "Invalid SQL value " + value );
        }
    }
    
    public static array ( value : Array<SqlLiteral> ) : SqlExpression {
        const valueExprs = value.map( elem => SqlExpression.literal( elem ) );
        
        return new SqlExpression( {
            type: 'expr_list',
            value: valueExprs.map( e => e.ast ),
        } as any )
    }
    
    public static string ( value : string ) : SqlExpression {
        return new SqlExpression( { type: 'single_quote_string', value } as any );
    }
    
    public static number ( value : number ) : SqlExpression {
        return new SqlExpression( { type: 'number', value } as any );
    }
    
    public static boolean ( value : boolean ) : SqlExpression {
        return new SqlExpression( { type: 'bool', value } as any );
    }
    
    public static date ( value : Date ) : SqlExpression {
        return new SqlExpression( { type: 'number', value: value.getTime() } as any );
    }
    
    public static null () {
        return new SqlExpression( { type: 'null' } as any );
    }
}

export type SqlLiteral = string | number | boolean | Date | null | Array<SqlLiteral>;


// extensions
declare module "node-sql-parser" {
    export type LogicOperator = 'OR' | 'AND';
    export type EqualityOperator = 'IN' | 'NOT IN' | 'LIKE' | 'NOT LIKE' | 'ILIKE' | 'NOT ILIKE' | '=' | '!=';
    export type MathOpsBinary = '|' | '&' | '>>' | '^' | '#' | '<<' | '>>';
    export type ComparisonOperator = '>' | '>=' | '<' | '<=' | '@>' | '<@' | '?' | '?|' | '?&' | '#>>' | '~' | '~*' | '!~' | '!~*' | '@@';
    export type AdditiveOperator = '||' | '-' | '#-' | '&&' | '+';
    export type MultiplicativeOperator = '*' | '%' | '/';
    export type ConstructOperator = 'AT TIME ZONE';
    export type BinaryOperator = LogicOperator | EqualityOperator | ComparisonOperator | AdditiveOperator | MultiplicativeOperator | MathOpsBinary | ConstructOperator;

    export type UnaryOperator = '+' | '-' | 'NOT' | 'IS NULL' | 'IS NOT NULL' | 'IS TRUE' | 'IS FALSE' | 'IS NOT TRUE' | 'IS NOT FALSE';
}

function astMapper( mapping : Record<string, any> ) {
    const apply = ( ast : any, ignoreMapping : boolean = false ) => {
        if ( ast instanceof Array ) {
            const cloned = [];
            for ( let i = 0; i < ast.length; i++ ) {
                cloned.push( apply( ast[ i ] ) );
            }
            
            return cloned;
        } else if ( typeof ast === 'object' && ast != null ) {
            if ( !ignoreMapping && ast.type in mapping ) {
                return mapping[ ast.type ]( ast );
            } else {
                const cloned = {};
                
                for ( const key of Object.keys( ast ) ) {
                    cloned[ key ] = apply( ast[ key ] );
                }
                
                return cloned;
            }
        } else {
            return ast;
        }
    };
    
    return apply;
}

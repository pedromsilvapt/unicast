import * as Case from "case";

export class InvalidOpError extends Error {
    public constructor ( kind : string, op : string = null ) {
        super( `Invalid operand: ${ kind } ${ op || '' }` );
    }
}

export class QueryLang {
    public static parser : QueryParser;

    public static embeddedParser : EmbeddedQueryParser;

    public static execute<C> ( query : string | QueryAst, semantics : QuerySemantics<C>, context : C ) : unknown {
        const expr = QueryLang.compile( query, semantics );

        return expr( context );
    }

    public static parse ( query : string ) : QueryAst {
        if ( this.parser == null ) {
            this.parser = new QueryParser();
        }

        return this.parser.parse( query );
    }

    public static embeddedParse ( query : string ) : EmbeddedQueryAst {
        if ( this.embeddedParser == null ) {
            this.embeddedParser = new EmbeddedQueryParser();
        }

        return this.embeddedParser.parse( query );
    }

    public static compile<C = any> ( query : string | QueryAst, semantics : QuerySemantics<C> ) : CompiledQuery<C> {
        if ( typeof query === 'string' ) {
            query = QueryLang.parse( query );
        }
        
        if ( query.kind === 'binaryOperator' ) {
            let customSemantics = semantics.getPropertyOperatorFor( query );

            if ( customSemantics != null ) {
                return customSemantics( query.lhs, query.op, query.rhs, semantics );
            }

            const lhs = QueryLang.compile( query.lhs, semantics );
            const rhs = QueryLang.compile( query.rhs, semantics );

            if ( query.op === BinaryOperator.Plus ) {
                return ( c ) => lhs( c ) as any + ( rhs( c ) as any );
            } else if ( query.op === BinaryOperator.Minus ) {
                return ( c ) => lhs( c ) as any - ( rhs( c ) as any );
            } else if ( query.op === BinaryOperator.Mul ) {
                return ( c ) => lhs( c ) as any * ( rhs( c ) as any );
            } else if ( query.op === BinaryOperator.Div ) {
                return ( c ) => lhs( c ) as any / ( rhs( c ) as any );
            } else if ( query.op === BinaryOperator.EqualTo ) {
                return ( c ) => lhs( c ) == rhs( c );
            } else if ( query.op === BinaryOperator.NotEqualTo ) {
                return ( c ) => lhs( c ) != rhs( c );
            } else if ( query.op === BinaryOperator.LessThanEqualTo ) {
                return ( c ) => lhs( c ) <= rhs( c );
            } else if ( query.op === BinaryOperator.LessThan ) {
                return ( c ) => lhs( c ) < rhs( c );
            } else if ( query.op === BinaryOperator.GreaterThanEqualTo ) {
                return ( c ) => lhs( c ) >= rhs( c );
            } else if ( query.op === BinaryOperator.GreaterThan ) {
                return ( c ) => lhs( c ) > rhs( c );
            } else if ( query.op === BinaryOperator.And ) {
                return ( c ) => lhs( c ) && rhs( c );
            } else if ( query.op === BinaryOperator.Or ) {
                return ( c ) => lhs( c ) || rhs( c );
            } else {
                throw new InvalidOpError( query.kind, query.op );
            }
        } else if ( query.kind === 'unaryOperator' ) {
            const rhs = QueryLang.compile( query.rhs, semantics );

            if ( query.op === UnaryOperator.Not ) {
                return ( c ) => !rhs( c );
            }
        } else if ( query.kind === 'identifier' ) {
            const name = query.name;

            const customSemantics = semantics.getPropertyFor( query );
            
            if ( customSemantics?.lookup != null ) {
                return customSemantics.lookup( name, semantics );
            } else {
                return ( c ) => c[ name ];
            }
        } else if ( query.kind === 'literal' ) {
            const value = query.value;

            return ( _ ) => value;
        }

        return null;
    }

    public static visit ( ast: QueryAst, visitor: ( node: QueryAst ) => any ) : void {
        const queue: QueryAst[] = [ ast ];
        
        let currentNode: QueryAst | undefined;
        
        while ( ( currentNode = queue.pop() ) != null ) {
            const stop = visitor( currentNode );

            if ( currentNode.kind === 'binaryOperator' ) {
                queue.push( currentNode.lhs, currentNode.rhs );
            } else if ( currentNode.kind === 'unaryOperator' ) {
                queue.push( currentNode.rhs );
            }

            if ( stop ) {
                break;
            }
        }
    }

    public static visitAny ( ast: QueryAst, visitor: ( node: QueryAst ) => any ) : boolean {
        let found: boolean = false;

        QueryLang.visit( ast, node => {
            if ( visitor( node ) ) {
                found = true;
            }

            return found;
        } );
        
        return found;
    }

    public static hasIdentifier ( ast: QueryAst, id: string ) : boolean {
        return QueryLang.visitAny( ast, node => {
            return node.kind === 'identifier' && node.name === id
        } );
    } 
}

export class QuerySemantics<C = any> {
    properties : Record<string, PropertySemantics<C>>;

    public constructor ( properties : Record<string, PropertySemantics<C>> = {} ) {
        this.properties = properties;
    }
    
    public getPropertyFor ( ast : QueryAst ) : PropertySemantics<C> | null {
        if ( ast.kind === 'identifier' && ast.name in this.properties ) {
            return this.properties[ ast.name ];
        }
        
        return null;
    }

    public getPropertyOperatorFor ( ast : QueryAst ) : BinaryOperatorSemantics<C> | null {
        if ( ast.kind === 'binaryOperator' ) {
            let propertySemantics = this.getPropertyFor( ast.lhs );

            if ( propertySemantics != null ) {
                return propertySemantics.getOperatorFor( ast.op );
            }
        }

        return null;
    }


    public static computed<C extends object> ( computed : ( ctx : C ) => unknown ) : PropertySemantics<C> {
        return new PropertySemantics<C>( {}, (_, __) => computed );
    }

    public static flagsEnum<C extends object> ( flagsGetter ?: ( ctx : C, property: string ) => string[] ) : PropertySemantics<C> {
        flagsGetter = flagsGetter ?? ( ( ctx, prop ) => ctx[ prop ] );
        
        const propertySemantics = new PropertySemantics<C>();
        
        propertySemantics.binaryOperators[ BinaryOperator.EqualTo ] = ( lhsAst, _, rhsAst, semantics ) => {
            const lhsName = lhsAst.kind == 'identifier' ? lhsAst.name : void 0;

            const rhs = QueryLang.compile( rhsAst, semantics ) as any;
    
            return ( context : C ) : boolean => {
                const childContext = Object.create( context );
                
                for ( let flag of flagsGetter( context, lhsName ) ) {
                    // Remove from the string anything that is invalid as an identifier:
                    //  - every character at the start that is not [a-zA-Z_]
                    //  - every character anywhere that is not [\w]
                    const name = Case.pascal( flag.replace(/(^[^a-zA-Z_])|[^\w]+/g, '-') );
                    
                    childContext[ name ] = true;
                }
    
                const result = rhs( childContext );
    
                return !!result;
            };
        };
    
        return propertySemantics;
    }
}

export enum PropertyType {
    Any,
    String,
    Number,
    Boolean
}

export enum BinaryOperator {
    And,
    Or,

    EqualTo,
    LessThan,
    LessThanEqualTo,
    GreaterThan,
    GreaterThanEqualTo,
    NotEqualTo,

    Plus,
    Minus,
    Mul,
    Div,
}

export enum UnaryOperator {
    Not,
}

export class PropertySemantics<C> {
    binaryOperators: Partial<Record<BinaryOperator, BinaryOperatorSemantics<C>>>;
    lookup: LookupSemantics<C>;

    public constructor ( operators : Partial<Record<BinaryOperator, BinaryOperatorSemantics<C>>> = {}, lookup ?: LookupSemantics<C> ) {
        this.binaryOperators = operators;
        this.lookup = lookup;
    }

    public getOperatorFor ( operator : BinaryOperator ) : BinaryOperatorSemantics<C> | null {
        if ( operator in this.binaryOperators ) {
            return this.binaryOperators[ operator ];
        }

        return null;
    }
}

export  type LookupSemantics<C> = ( name: string, semantics: QuerySemantics<C> ) => ( ctx : C ) => unknown;

export type BinaryOperatorSemantics<C> = ( lhs : QueryAst, operator : BinaryOperator, rhs : QueryAst, semantics : QuerySemantics<C> ) => ( ctx : C ) => unknown;

export type QueryAst = 
      { kind: 'binaryOperator', op: BinaryOperator, lhs: QueryAst, rhs: QueryAst }
    | { kind: 'unaryOperator', op: UnaryOperator, rhs: QueryAst }
    | { kind: 'identifier', name: string }
    | { kind: 'literal', value: string | number | boolean }
    ;
export type EmbeddedQueryAst = { kind: 'root', body: string, embeddedQuery: string };

export type CompiledQuery<C> = ( context : C ) => unknown;

/* Lexer & Parser */
import { Lexer, createToken, CstParser, ICstVisitor, TokenType } from 'chevrotain';

const EmbeddedPrefixChunk = createToken( { name: "EmbeddedPrefixChunk", pattern: /[^\\\?]+/ } );

// TODO Make it work if the input ends with a single backslash
const EmbeddedEscape = createToken( { name: "EmbeddedEscape", pattern: /\\./ } );

const EmbeddedSeparator = createToken( { name: "EmbeddedSeparator", pattern: /\?/, push_mode: 'suffix' } );

const EmbeddedSuffix = createToken( { name: "EmbeddedSuffix", pattern: /.+/ } );

const Comma = createToken( { name: "Comma", pattern: /,/ } );

const Identifier = createToken( { name: "Identifier", pattern: /[a-zA-Z_]\w*/ } );

const LogicOperator = createToken( { name: "LogicOperator", pattern: Lexer.NA } );

const And = createToken( { name: "And", pattern: /and/i, longer_alt: Identifier, categories: LogicOperator } );

const Or = createToken( { name: "Or", pattern: /or/i, longer_alt: Identifier, categories: LogicOperator } );

const Not = createToken( { name: "Not", pattern: /not/i, longer_alt: Identifier } );

const Bool = createToken( { name: "Bool", pattern: Lexer.NA } );

const True = createToken( { name: "True", pattern: /true/i, longer_alt: Identifier, categories: Bool } );

const False = createToken( { name: "False", pattern: /false/i, longer_alt: Identifier, categories: Bool } );

const Integer = createToken( { name: "Integer", pattern: /0|[1-9]\d*/ } );

const String = createToken( { name: "String", pattern: /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/ } );

const ComparisonOperator = createToken( { name: "ComparisonOperator", pattern: Lexer.NA } );

const EqualTo = createToken( { name: "EqualTo", pattern: /=/, categories: ComparisonOperator } );

const NotEqualTo = createToken( { name: "NotEqualTo", pattern: /!=/, categories: ComparisonOperator } );

const GreaterThanEqualTo = createToken( { name: "GreaterThanEqualTo", pattern: />=/, categories: ComparisonOperator } );

const GreaterThan = createToken( { name: "GreaterThan", pattern: />/, categories: ComparisonOperator } );

const LessThanEqualTo = createToken( { name: "LessThanEqualTo", pattern: /<=/, categories: ComparisonOperator } );

const LessThan = createToken( { name: "LessThan", pattern: /</, categories: ComparisonOperator } );

const AdditionOperator = createToken( { name: "AdditionOperator", pattern: Lexer.NA } );

const Plus = createToken( { name: "Plus", pattern: /\+/, categories: AdditionOperator } );

const Minus = createToken( { name: "Plus", pattern: /\-/, categories: AdditionOperator } );

const MultiplicationOperator = createToken( { name: "MultiplicationOperator", pattern: Lexer.NA } );

const Mul = createToken( { name: "Plus", pattern: /\*/, categories: MultiplicationOperator } );

const Div = createToken( { name: "Plus", pattern: /\//, categories: MultiplicationOperator } );

const LParen = createToken( { name: "LParen", pattern: /\(/ } );

const RParen = createToken( { name: "RParen", pattern: /\)/ } );

const WhiteSpace = createToken( {
  name: "WhiteSpace",
  pattern: /\s+/,
  group: Lexer.SKIPPED
} );

const AllQueryTokens = [
    WhiteSpace,
    // "keywords" appear before the Identifier
    And,
    Or,
    Not,
    LogicOperator,

    True,
    False,
    Bool,
    
    // The Identifier must appear after the keywords because all keywords are valid identifiers.
    Identifier,
    Integer,
    String,

    GreaterThanEqualTo,
    GreaterThan,
    LessThanEqualTo,
    LessThan,
    NotEqualTo,
    EqualTo,
    ComparisonOperator,

    Plus,
    Minus,
    AdditionOperator,
    Mul,
    Div,
    MultiplicationOperator,

    LParen,
    RParen,
    Comma,
];

const EmbeddedQueryTokens = [
    EmbeddedPrefixChunk,
    EmbeddedEscape,
    EmbeddedSeparator,
    EmbeddedSuffix,
];

const EmbeddedQueryDefinition = {
    modes: {
        prefix: [
            EmbeddedPrefixChunk,
            EmbeddedEscape,
            EmbeddedSeparator,
        ],
        suffix: [
            EmbeddedSuffix,
        ]
    },
    defaultMode: 'prefix'
};

export const QueryLexer = new Lexer( AllQueryTokens );
export const EmbeddedQueryLexer = new Lexer( EmbeddedQueryDefinition );

class QueryCstParser extends CstParser {
    constructor() {
      super( AllQueryTokens );

      this.performSelfAnalysis();
    }

    public expression = this.RULE( 'expression', () => {
        this.OPTION(() => {
            this.SUBRULE(this.logicExpression);
        });
    } );

    public logicExpression = this.RULE( 'logicExpression', () => {
        this.SUBRULE(this.comparisonExpression, { LABEL: "lhs" } );
        
        this.MANY( () => {
            // consuming 'AdditionOperator' will consume either Plus or Minus as they are subclasses of AdditionOperator
            this.CONSUME( LogicOperator );
            //  the index "2" in SUBRULE2 is needed to identify the unique position in the grammar during runtime
            this.SUBRULE2( this.logicExpression, { LABEL: "rhs" } );
        } );
    } );

    public comparisonExpression = this.RULE( 'comparisonExpression', () => {
        this.SUBRULE(this.additionExpression, { LABEL: "lhs" } );
        
        this.MANY( () => {
            // consuming 'AdditionOperator' will consume either Plus or Minus as they are subclasses of AdditionOperator
            this.CONSUME( ComparisonOperator );
            //  the index "2" in SUBRULE2 is needed to identify the unique position in the grammar during runtime
            this.SUBRULE2( this.comparisonExpression, { LABEL: "rhs" } );
        } );
    } );

    public additionExpression = this.RULE( 'additionExpression', () => {
        this.SUBRULE(this.multiplicationExpression, { LABEL: "lhs" } );
        
        this.MANY( () => {
            // consuming 'AdditionOperator' will consume either Plus or Minus as they are subclasses of AdditionOperator
            this.CONSUME( AdditionOperator );
            //  the index "2" in SUBRULE2 is needed to identify the unique position in the grammar during runtime
            this.SUBRULE2( this.additionExpression, { LABEL: "rhs" } );
        } );
    } );

    public multiplicationExpression = this.RULE( 'multiplicationExpression', () => {
        this.SUBRULE(this.atomicExpression, { LABEL: "lhs" } );
        
        this.MANY( () => {
            // consuming 'AdditionOperator' will consume either Plus or Minus as they are subclasses of AdditionOperator
            this.CONSUME( MultiplicationOperator );
            //  the index "2" in SUBRULE2 is needed to identify the unique position in the grammar during runtime
            this.SUBRULE2( this.multiplicationExpression, { LABEL: "rhs" } );
        } );
    } );

    public atomicExpression = this.RULE( "atomicExpression", () => {
        this.OR([
          // parenthesisExpression has the highest precedence and thus it appears
          // in the "lowest" leaf in the expression ParseTree.
          { ALT: () => this.SUBRULE( this.parenthesisExpression ) },
          { ALT: () => this.SUBRULE( this.notExpression ) },
          { ALT: () => this.CONSUME( Identifier ) },
          { ALT: () => this.CONSUME( Integer ) },
          { ALT: () => this.CONSUME( String ) },
          { ALT: () => this.CONSUME( Bool ) },
        ] );
    } );

    public parenthesisExpression = this.RULE( 'parenthesisExpression', () => {
        this.CONSUME( LParen );
        this.SUBRULE( this.expression );
        this.CONSUME( RParen );
    } );

    public notExpression = this.RULE( 'notExpression', () => {
        this.CONSUME( Not );
        this.SUBRULE( this.expression );
    } );
}

export class QueryParser {
    protected cstParser : QueryCstParser;

    protected visitor : ICstVisitor<void, QueryAst>;

    public constructor () {
        this.cstParser = new QueryCstParser();

        const BaseQueryVisitor : { new () : ICstVisitor<void, QueryAst> } = this.cstParser.getBaseCstVisitorConstructor();
        
        this.visitor = new class extends BaseQueryVisitor {
            public constructor () {
                super();

                this.validateVisitor();
            }

            public binaryOperator ( tokenType : TokenType ) : BinaryOperator {
                if ( tokenType == And ) return BinaryOperator.And
                else if ( tokenType == Or ) return BinaryOperator.Or
                else if ( tokenType == Plus ) return BinaryOperator.Plus
                else if ( tokenType == Minus ) return BinaryOperator.Minus
                else if ( tokenType == Mul ) return BinaryOperator.Mul
                else if ( tokenType == Div ) return BinaryOperator.Div
                else if ( tokenType == EqualTo ) return BinaryOperator.EqualTo
                else if ( tokenType == NotEqualTo ) return BinaryOperator.NotEqualTo
                else if ( tokenType == LessThan ) return BinaryOperator.LessThan
                else if ( tokenType == LessThanEqualTo ) return BinaryOperator.LessThanEqualTo
                else if ( tokenType == GreaterThan ) return BinaryOperator.GreaterThan
                else if ( tokenType == GreaterThanEqualTo ) return BinaryOperator.GreaterThanEqualTo;
            }

            public expression ( ctx ) : QueryAst {
                if ( ctx.logicExpression ) {
                    return this.visit( ctx.logicExpression );
                } else {
                    return { kind: 'literal', value: void 0 };
                }
            }

            public logicExpression ( ctx ) {
                let lhs = this.visit( ctx.lhs );

                if ( ctx.rhs ) {
                    for ( let [ i, rhsNode ] of ctx.rhs.entries() ) {
                        const op = this.binaryOperator( ctx.LogicOperator[ i ].tokenType );

                        const rhs = this.visit( rhsNode );
                        
                        lhs = { kind: 'binaryOperator', lhs, op, rhs };
                    }
                }

                return lhs;
            }

            public comparisonExpression ( ctx ) {
                let lhs = this.visit( ctx.lhs );

                if ( ctx.rhs ) {
                    for ( let [ i, rhsNode ] of ctx.rhs.entries() ) {
                        const op = this.binaryOperator( ctx.ComparisonOperator[ i ].tokenType )

                        const rhs = this.visit( rhsNode );
                        
                        lhs = { kind: 'binaryOperator', lhs, op, rhs };
                    }
                }

                return lhs;
            }

            public additionExpression ( ctx ) {
                let lhs = this.visit( ctx.lhs );

                if ( ctx.rhs ) {
                    for ( let [ i, rhsNode ] of ctx.rhs.entries() ) {
                        const op = this.binaryOperator( ctx.AdditionOperator[ i ].tokenType );

                        const rhs = this.visit( rhsNode );
                        
                        lhs = { kind: 'binaryOperator', lhs, op, rhs };
                    }
                }

                return lhs;
            }

            public multiplicationExpression ( ctx ) {
                let lhs = this.visit( ctx.lhs );

                if ( ctx.rhs ) {
                    for ( let [ i, rhsNode ] of ctx.rhs.entries() ) {
                        const op = this.binaryOperator( ctx.MultiplicationOperator[ i ].tokenType );

                        const rhs = this.visit( rhsNode );
                        
                        lhs = { kind: 'binaryOperator', lhs, op, rhs };
                    }
                }

                return lhs;
            }

            public atomicExpression ( ctx ) : QueryAst {
                if ( ctx.parenthesisExpression ) {
                    return this.visit( ctx.parenthesisExpression );
                } else if ( ctx.notExpression ) {
                    return this.visit( ctx.notExpression );
                } else if ( ctx.Identifier ) {
                    return { kind: 'identifier', name: ctx.Identifier[ 0 ].image };
                } else if ( ctx.Integer ) {
                    return { kind: 'literal', value: parseInt( ctx.Integer[ 0 ].image, 10 ) };
                } else if ( ctx.String ) {
                    return { kind: 'literal', value: ( ctx.String[ 0 ].image as string ).slice( 1, -1 ) };
                } else if ( ctx.Bool ) {
                    return { kind: 'literal', value: ctx.Bool[ 0 ].image.toLowerCase() == 'true' };
                }
            }

            public parenthesisExpression ( ctx ) {
                return this.visit( ctx.expression );
            }

            public notExpression ( ctx ) : QueryAst {
                return { kind: 'unaryOperator', op: UnaryOperator.Not, rhs: this.visit( ctx.expression ) };
            }
        };
    }

    public parse ( query : string ) : QueryAst {
        const lexResult = QueryLexer.tokenize( query );
        
        this.cstParser.input = lexResult.tokens;

        const cst = this.cstParser.expression();

        if (this.cstParser.errors.length > 0) {
            throw Error(
                "Sad sad panda, parsing errors detected!\n" +
                this.cstParser.errors[0].message
            );
        }

        // Visit
        return this.visitor.visit( cst );
    }
}

export class EmbeddedQueryCstParser extends CstParser {
    constructor () {
        super( EmbeddedQueryTokens );

        this.performSelfAnalysis();
    }
  
    public embeddedRoot = this.RULE( 'embeddedRoot', () => {
        this.MANY( () => {
            this.SUBRULE( this.embeddedPrefix );
        } );
        this.OPTION1( () => {
            this.CONSUME( EmbeddedSeparator );
            this.OPTION2( () => {
                this.CONSUME( EmbeddedSuffix );
            } );
        } );
    } );
  
    public embeddedPrefix = this.RULE( 'embeddedPrefix', () => {
        this.OR([
            { ALT: () => this.CONSUME( EmbeddedPrefixChunk ) },
            { ALT: () => this.CONSUME( EmbeddedEscape ) },
        ] );
    } );
}

export class EmbeddedQueryParser {
    protected cstParser : EmbeddedQueryCstParser;

    protected visitor : ICstVisitor<void, EmbeddedQueryAst | string>;

    public constructor () {
        
        this.cstParser = new EmbeddedQueryCstParser();

        const BaseQueryVisitor : { new () : ICstVisitor<void, EmbeddedQueryAst | string> } = this.cstParser.getBaseCstVisitorConstructor();
        
        this.visitor = new class extends BaseQueryVisitor {
            public constructor () {
                super();

                this.validateVisitor();
            }

            public embeddedRoot ( ctx ) : EmbeddedQueryAst {
                let body = ctx.embeddedPrefix
                    ? ctx.embeddedPrefix.map(prefix => this.visit(prefix)).join('')
                    : '';

                const embeddedQuery = ctx.EmbeddedSuffix
                    ? ctx.EmbeddedSuffix[ 0 ].image
                    : ( ctx.EmbeddedSeparator ? '' : null );

                return { kind: 'root', body, embeddedQuery };
            }

            public embeddedPrefix ( ctx ) : string {
                if ( ctx.EmbeddedPrefixChunk ) {
                    return ctx.EmbeddedPrefixChunk[ 0 ].image;
                } else {
                    return ctx.EmbeddedEscape[ 0 ].image[ 1 ];
                }
            }
        };
    }

    public parse ( query : string ) : EmbeddedQueryAst {
        const lexResult = EmbeddedQueryLexer.tokenize( query );
        
        this.cstParser.input = lexResult.tokens;

        const cst = this.cstParser.embeddedRoot();

        if (this.cstParser.errors.length > 0) {
            throw Error(
                "Sad sad panda, parsing errors detected!\n" +
                this.cstParser.errors[0].message
            );
        }

        // Visit
        return this.visitor.visit( cst ) as EmbeddedQueryAst;
    }
}

// Media Records
import { CollectionRecord } from './Database/Database';
import { MediaRecord, PersonRecord, RoleRecord } from './MediaRecord';

interface PartialMediaRecord extends MediaRecord {
    collections ?: CollectionRecord[];
    cast ?: PersonRecord[];
    genres ?: string[]
}

export enum MediaRecordRelations {
    Collections,
    Cast,
    TvSeason,
    TvShow,
}

export class MediaRecordQuerySemantics<C extends PartialMediaRecord> extends QuerySemantics<C> {
    public features = {
        collection: false,
        repository: false,
        cast: false,
        genre: false,
    };

    public constructor ( properties : Record<string, PropertySemantics<C>> = {} ) {
        super( {
            collection: QuerySemantics.flagsEnum( ctx => ctx.collections?.map( c => c.title ) ?? [] ),
            repository: QuerySemantics.flagsEnum( ctx => ctx.repositoryPaths.flatMap( p => p.split( '/' ) ) ),
            cast: QuerySemantics.flagsEnum( ctx => ctx.cast?.map( p => p.name ) ?? [] ),
            genre: QuerySemantics.flagsEnum( ctx => ctx.genres ?? [] ),
            ...properties
        } );
    }
}

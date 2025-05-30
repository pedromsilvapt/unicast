import { UnicastServer } from './UnicastServer';
import { groupingBy, first, collect } from 'data-collectors';

interface Class<T> { new ( ...args : any[] ) : T };

export enum AuthenticationResult {
    Disallowed = 'disallowed',
    Allowed = 'allowed',
    Unknown = 'unknown'
}

export type CoverageResult = AuthenticationResult;
export const CoverageResult = AuthenticationResult;

export interface AccessControlConfig {
    identities?: IdentityRuleConfig[];
    resources?: ResourceRuleConfig[];
    rules?: Record<string, string>;
}

export interface IdentityRuleConfig {
    kind: string;
    name: string;
}

export interface ResourceRuleConfig {
    name: string;
    kind: string;
};

export class AccessControl {
    public static fromServer ( server : UnicastServer ) : AccessControl {
        return AccessControl.fromConfig( server.config.get<AccessControlConfig>( 'server.acl', {} ) );
    }

    public static fromConfig ( config : AccessControlConfig ) : AccessControl {
        const identities = IdentityRule.fromList( config.identities ?? [] );
        identities.push( new AnyIdentityRule() );

        const resources = ResourceRule.fromList( config.resources ?? [] );

        resources.push( new ScopeResourceRule( 'All', 'all' ) );
        resources.push( new ScopeResourceRule( 'Write', 'write' ) );
        resources.push( new ScopeResourceRule( 'Control', 'control' ) );
        resources.push( new ScopeResourceRule( 'Read', 'read' ) );

        const symbols = [
            ...identities.map( id => id.name ),
            ...resources.map( id => id.name ),
            ...Object.keys( config.rules ?? {} ),
        ];

        const rules = Rule.fromObject( config.rules ?? {}, new RuleSemantics( symbols ) );

        return new AccessControl( identities, resources, rules );
    }

    public identities : Map<string, IdentityRule>;

    public resources : Map<string, ResourceRule>;

    public rules : Record<string, Rule>;

    public constructor ( identities : IdentityRule[] = [], resources : ResourceRule[] = [], rules: Record<string, Rule> = {} ) {
        this.identities = collect( identities, groupingBy( id => id.name, first() ) );
        this.resources = collect( resources, groupingBy( res => res.name, first() ) );
        this.rules = rules;
    }

    public authenticateRule (
        ruleName : string,
        identity : AccessCard,
        resource : Resource
    ) : boolean {
        const rule = this.rules[ ruleName ];

        if ( rule == null ) {
            throw new Error( `ACL Rule "${ruleName}" not found.` );
        }

        return rule.authenticate( this, identity, resource );
    }

    public authenticate (
        identity : AccessCard,
        resource : Resource
    ) : boolean {
        return this.authenticateRule( 'main', identity, resource );
    }
}

import { QueryLang, QueryAst, CompiledQuery, QuerySemantics, PropertySemantics, MediaRecordQuerySemantics } from './QueryLang';

export interface RuleContext {
    acl : AccessControl;
    identity : AccessCard;
    resource : Resource;
    symbolsCache: Record<string, unknown>;
}

export class RuleSemantics extends QuerySemantics<RuleContext> {
    protected static propertySemantic ( symbol : string, defaultResult ?: boolean ) {
        return ( ctx : RuleContext ) => {
            if ( symbol in ctx.symbolsCache ) {
                return ctx.symbolsCache[ symbol ];
            }

            ctx.symbolsCache[ symbol ] = void 0;

            if ( ctx.acl.identities.has( symbol ) ) {
                const identity = ctx.acl.identities.get( symbol );

                return ctx.symbolsCache[ symbol ] = identity.identify( ctx.identity, defaultResult );
            } else if ( ctx.acl.resources.has( symbol ) ) {
                const resource = ctx.acl.resources.get( symbol );

                return ctx.symbolsCache[ symbol ] = resource.covers( ctx.resource, defaultResult );
            } else if ( symbol in ctx.acl.rules ) {
                ctx.symbolsCache[ symbol ] = void 0;

                return ctx.symbolsCache[ symbol ] = ctx.acl.rules[ symbol ].expression( ctx );
            } else {
                return void 0;
            }
        };
    }

    protected static buildProperties ( symbols : string[] ) : Record<string, PropertySemantics<RuleContext>> {
        const properties : Record<string, PropertySemantics<RuleContext>> = {};

        for ( const symbol of symbols ) {
            properties[ symbol ] = QuerySemantics.computed( this.propertySemantic( symbol ) );
            properties[ 'can' + symbol ] = QuerySemantics.computed( this.propertySemantic( symbol, true ) );
            properties[ 'cannot' + symbol ] = QuerySemantics.computed( this.propertySemantic( symbol, false ) );
            properties[ 'is' + symbol ] = QuerySemantics.computed( this.propertySemantic( symbol, true ) );
            properties[ 'isnot' + symbol ] = QuerySemantics.computed( this.propertySemantic( symbol, false ) );
        }

        return properties;
    }

    constructor ( symbols : string[] = [] ) {
        super( RuleSemantics.buildProperties( symbols ) );
    }
}

export class Rule {
    public static fromObject ( rules : Record<string, string>, semantics : RuleSemantics ) : Record<string, Rule> {
        const rulesObject: Record<string, Rule> = {};

        for ( let ruleName of Object.keys( rules ) ) {
            rulesObject[ ruleName ] = Rule.fromConfig( rules[ ruleName ], semantics );
        }

        return rulesObject;
    }

    public static fromConfig ( expression : string, semantics : RuleSemantics ) : Rule {
        const ast = QueryLang.parse( expression );

        return new Rule( QueryLang.compile( ast, semantics ) );
    }

    public expression : CompiledQuery<RuleContext>;

    public constructor ( expression : CompiledQuery<RuleContext> ) {
        this.expression = expression;
    }

    public authenticate (
        acl : AccessControl,
        identity : AccessCard,
        resource : Resource
    ) : boolean {
        return !!this.expression( {
            acl, identity, resource,
            symbolsCache: {}
        } );
    }
}

export class AccessCard {
    identities : Identity[];

    public constructor ( identities : Identity[] = [] ) {
        this.identities = identities;
    }

    public as<T extends Identity> ( credential : Class<T> ) : T[] {
        return this.identities.filter((c): c is T => c instanceof credential );
    }
}

export abstract class Identity { }

export abstract class IdentityRule {
    public static fromList ( ruleConfig : IdentityRuleConfig[] ) : IdentityRule[] {
        return ruleConfig.map( ruleConfig => IdentityRule.fromConfig( ruleConfig ) );
    }

    public static fromConfig ( ruleConfig : IdentityRuleConfig ) : IdentityRule {
        if ( ruleConfig.kind == 'ip' ) {
            return IpIdentityRule.fromConfig( ruleConfig as IpIdentityRuleConfig );
        } else if ( ruleConfig.kind == 'any' ) {
            return AnyIdentityRule.fromConfig( ruleConfig as AnyIdentityRuleConfig );
        } else {
            throw new Error( `Unknown ACL rule kind: "${ ruleConfig.kind }"` );
        }
    }

    public name: string;
    public kind : string;

    public constructor ( name: string, kind : string ) {
        this.name = name;
        this.kind = kind;
    }

    abstract identify ( identity : AccessCard, defaultResult ?: boolean ) : boolean;
}

export abstract class Resource { }

export abstract class ResourceRule {
    public name : string;

    public kind : string;

    public constructor ( name : string, kind : string ) {
        this.name = name;
        this.kind = kind;
    }

    abstract covers ( resource : Resource, defaultResult ?: boolean ) : boolean;

    public static fromList ( resources : ResourceRuleConfig[] ) : ResourceRule[] {
        return resources.map( rule => ResourceRule.fromConfig( rule ) );
    }

    public static fromConfig ( resource : ResourceRuleConfig ) : ResourceRule {
        switch ( resource.kind ) {
            case 'scope':
                return ScopeResourceRule.fromConfig( resource as ScopeResourceRuleConfig );
            case 'entity':
                return EntityResourceRule.fromConfig( resource as EntityResourceRuleConfig );
            default:
                throw new Error( `Unknown resource rule kind: "${ resource.kind }"` );
        }
    }
}

export class ScopeResource extends Resource {
    scope: string;

    public constructor ( scope : string ) {
        super();

        this.scope = scope;
    }
}

export interface ScopeResourceRuleConfig extends ResourceRuleConfig {
    scope: string;
}

export class ScopeResourceRule extends ResourceRule {
    public static fromConfig ( config : ScopeResourceRuleConfig ) : ScopeResourceRule {
        return new ScopeResourceRule( config.name, config.scope );
    }

    scope : string;

    public constructor ( name: string, scope : string ) {
        super( name, 'scope' );

        this.scope = scope;
    }

    public covers ( resource : Resource, defaultResult : boolean = true ) : boolean {
        if ( resource instanceof ScopeResource ) {
            if ( resource.scope == 'read' ) {
                return [ 'all', 'write', 'control', 'read' ].includes( this.scope );
            } else if ( resource.scope == 'control' ) {
                return [ 'all', 'write', 'control' ].includes( this.scope );
            } else if ( resource.scope == 'write' ) {
                return [ 'all', 'write' ].includes( this.scope );
            } else if ( resource.scope == 'all' ) {
                return this.scope == 'all';
            } else {
                return false;
            }
        }

        return defaultResult;
    }
}


export class EntityResource extends Resource {
    entityType : string;

    data : any;

    public constructor ( entityType : string, data : any ) {
        super();

        this.entityType = entityType;
        this.data = data;
    }
}

export interface EntityResourceRuleConfig extends ResourceRuleConfig {
    entityTypes: string[];
    expression: string;
    mediaSemantics?: boolean;
}

export class EntityResourceRule extends ResourceRule {
    public static fromConfig ( config : EntityResourceRuleConfig ) : EntityResourceRule {
        const semantics = config.mediaSemantics ? new MediaRecordQuerySemantics() : new QuerySemantics();

        return new EntityResourceRule( config.name, config.entityTypes, QueryLang.compile( config.expression, semantics ) );
    }

    entityTypes: string[];
    expression: CompiledQuery<any>;

    public constructor ( name: string, entityTypes : string[], expression : CompiledQuery<any> ) {
        super( name, 'tableQuery' );

        this.entityTypes = entityTypes;
        this.expression = expression;
    }

    public covers ( resource : Resource, defaultResult ?: boolean ) : boolean {
        if ( resource instanceof EntityResource && this.entityTypes.includes( resource.entityType ) ) {
            return !!this.expression( resource.data );
        }

        return defaultResult;
    }
}

/* Ip Authentication */
import * as ipFilter from "ip-filter";

export interface IpIdentityRuleConfig extends IdentityRuleConfig {
    patterns: string[];
}

export class IpIdentityRule extends IdentityRule {
    public static fromConfig ( ruleConfig : IpIdentityRuleConfig ) : IpIdentityRule {
        return new IpIdentityRule( ruleConfig.name, ruleConfig.kind, ruleConfig.patterns )
    }

    public patterns: string[];

    public constructor ( name: string, kind : string, patterns : string[] ) {
        super( name, kind );

        this.patterns = patterns;
    }

    public identify ( identity : AccessCard, defaultResult : boolean = false ) : boolean {
        if ( this.patterns != null ) {
            const ipIdentities = identity.as( IpIdentity );

            return ipIdentities.some( c => ipFilter( c.address, this.patterns ) );
        }

        return defaultResult;
    }
}

export class IpIdentity extends Identity {
    public address : string;

    public constructor ( address : string ) {
        super();

        this.address = address;
    }
}

/* Any Rule - Authenticates every user */

export interface AnyIdentityRuleConfig extends IdentityRuleConfig { }

export class AnyIdentityRule extends IdentityRule {
    public static fromConfig ( ruleConfig : AnyIdentityRuleConfig ) : AnyIdentityRule {
        return new AnyIdentityRule( ruleConfig.name );
    }

    public constructor ( name : string = 'Any' ) {
        super( name, 'any' );
    }

    public identify ( identity : AccessCard ) : boolean {
        return true;
    }
}

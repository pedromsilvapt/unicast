import { UnicastServer } from './UnicastServer';

interface Class<T> { new ( ...args : any[] ) : T };

export enum AuthenticationResult {
    Disallowed = 'disallowed',
    Allowed = 'allowed',
    Unknown = 'unknown'
}

export class AccessControl {
    public static fromServer ( server : UnicastServer ) : AccessControl {
        const acl = server.config.get( 'server.acl', [] );

        const rules = acl.map( ruleConfig => {
            if ( ruleConfig.kind == 'ip' ) {
                return IpRule.fromConfig( ruleConfig );
            } else if ( ruleConfig.kind == 'any' ) {
                return AnyRule.fromConfig( ruleConfig );
            } else {
                throw new Error( `Unknown ACL rule kind: "${ ruleConfig.kind }"` );
            }
        } );

        return new AccessControl( rules );
    }
    
    public rules : Rule[];

    public constructor ( rules : Rule[] = [] ) {
        this.rules = rules;
    }

    public authenticate ( 
        identity : AccessIdentity, 
        resource : ResourceRule 
    ) : boolean {
        if ( this.rules.length == 0 ) {
            return true;
        }

        for ( let rule of this.rules ) {
            const result = rule.authenticate( identity, resource );

            if ( result != AuthenticationResult.Unknown ) {
                return result == AuthenticationResult.Allowed;
            }
        }

        return false;
    }
}

export class AccessIdentity {
    credentials : Credential[];

    public constructor ( credentials : Credential[] = [] ) {
        this.credentials = credentials;
    }

    public as<T extends Credential> ( credential : Class<T> ) : T[] {
        return this.credentials.filter((c): c is T => c instanceof credential );
    }
}

export abstract class Credential { }

export abstract class Rule {
    kind : string;
    allow : ResourceRule[];
    disallow : ResourceRule[];

    public constructor ( kind : string, allow : ResourceRule[], disallow : ResourceRule[] ) {
        this.kind = kind;
        this.allow = allow;
        this.disallow = disallow;
    }

    abstract identify ( identity : AccessIdentity ) : boolean;

    public authenticate ( identity : AccessIdentity, resource : ResourceRule ) : AuthenticationResult {
        if ( this.identify( identity ) ) {
            if ( this.allow.length > 0 ) {
                if ( !this.allow.some( r => r.covers( resource ) ) ) {
                    return AuthenticationResult.Unknown;
                }
            }

            if ( this.disallow.length > 0 ) {
                if ( this.disallow.some( r => r.covers( resource ) ) ) {
                    return AuthenticationResult.Disallowed;
                }
            }

            return AuthenticationResult.Allowed;
        } else {
            return AuthenticationResult.Unknown;
        }
    }
}

export interface ResourceRuleConfig { kind: string };

export type ResourceListConfig = string 
                               | ResourceRuleConfig 
                               | ( string | ResourceRuleConfig)[];

export abstract class ResourceRule {
    abstract covers ( resource : ResourceRule ) : boolean;

    public static fromList ( resources : ResourceListConfig ) : ResourceRule[] {
        if ( resources instanceof Array ) {
            return resources.map( rule => ResourceRule.fromConfig( rule ) );
        } else if ( resources != null ) {
            return [ ResourceRule.fromConfig( resources ) ];
        } else {
            return [];
        }
    }

    public static fromConfig ( resource : string | ResourceRuleConfig ) : ResourceRule {
        if ( typeof resource === 'string' ) {
            return new ScopeRule( resource );
        } else {
            switch ( resource.kind ) {
                case 'scope':
                    // TODO: Make typesafe
                    return new ScopeRule( ( resource as any ).scope )
                default:
                    throw new Error( `Unknown resource rule kind: "${ resource.kind }"` );
            }
        }
    }
}

export class ScopeRule extends ResourceRule {
    scope : string;
    
    public constructor ( scope : string ) {
        super();

        this.scope = scope;
    }

    public covers ( resource : ResourceRule ) : boolean {
        if ( resource instanceof ScopeRule ) {
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

        return false;
    }
}

/* Ip Authentication */
import * as ipFilter from "ip-filter";

export class IpRule extends Rule {
    public static fromConfig ( ruleConfig : any ) : IpRule {
        let allowed = ResourceRule.fromList( ruleConfig.allow );

        let disallowed = ResourceRule.fromList( ruleConfig.disallow )

        return new IpRule( ruleConfig.kind, allowed, disallowed, ruleConfig.patterns )
    }

    public patterns: string[];

    public constructor ( kind : string, allow : ResourceRule[], disallow : ResourceRule[], patterns : string[] ) {
        super( kind, allow, disallow );

        this.patterns = patterns;
    }

    public identify ( identity : AccessIdentity ) : boolean {
        if ( this.patterns != null ) {
            const ipCredentials = identity.as( IpCredential );

            return ipCredentials.some( c => ipFilter( c.address, this.patterns ) );
        }

        return false;
    }
}

export class IpCredential extends Credential {
    public address : string;

    public constructor ( address : string ) {
        super();

        this.address = address;
    }
}

/* Any Rule - Authenticates every user */

export class AnyRule extends Rule {
    public static fromConfig ( ruleConfig : any ) : AnyRule {
        let allowed = ResourceRule.fromList( ruleConfig.allow );

        let disallowed = ResourceRule.fromList( ruleConfig.disallow );

        return new AnyRule( ruleConfig.kind, allowed, disallowed );
    }

    public identify ( identity : AccessIdentity ) : boolean {
        return true;
    }
}

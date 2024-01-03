import { Request } from 'restify';

export class BaseUrl {
    public static fromComponents ( protocol : string, host : string, port : number ) : BaseUrl {
        return new BaseUrl( `${ protocol }://${ host }:${ port }` );
    }

    public static fromString ( baseUrl : string ) : BaseUrl {
        return new BaseUrl( baseUrl );
    }

    public static fromRequest( req : Request | null, options ?: BaseUrlRequestOptions ) : BaseUrl {
        let useSsl = options?.fallbackUseSsl ?? false;

        if ( req != null ) {
            useSsl = !!( req.socket as any ).encrypted;

            const forwardedHost = req.headers[ 'x-forwarded-host' ];

            if ( forwardedHost != null ) {
                const forwardedProto = req.headers[ 'x-forwarded-proto' ];

                return BaseUrl.fromString( `${ forwardedProto || 'http' }://${ forwardedHost }` );
            }

            // Check if an 'Host' header was provided. Not all requests will carry this, but if they
            // do, we will honor them
            const host = req.headers[ 'host' ];
            // The protocol https or http, determined by checking if the incoming request
            // was encrypted or not
            const protocol = useSsl ? 'https' : 'http';
            // The default protocol port (used only if no custom port is being used)
            const protocolPort = useSsl ? 443 : 80;

            if ( host != null ) {
                const hostSegments = host.split( ':' );

                const hostAddress = hostSegments[0];

                const hostPort = hostSegments.length > 1
                    ? parseInt( hostSegments[1] )
                    : protocolPort;

                return this.fromComponents( protocol, hostAddress, hostPort );
            }
        }

        if ( useSsl ) {
            return options?.fallbackSecureUrl;
        } else {
            return options?.fallbackUrl;
        }
    }

    protected prefix : string;

    protected constructor( prefix : string ) {
        this.prefix = prefix;
    }

    public get ( path : string ) {
        if ( path != null && path != '' ) {
            if ( !path.startsWith( '/' ) ) {
                path = '/' + path;
            }

            return this.prefix + path;
        } else {
            return this.prefix;
        }
    }
}

export interface BaseUrlRequestOptions {
    /**
     * Used when no Forward host or Host headers are present. Should be considered
     * the default HTTP `url` through which this app is served
     */
    fallbackUrl ?: BaseUrl;
    /**
     * Used when no Forward host or Host headers are present. Should be considered
     * the default HTTPS `url` through which this app is served
     */
    fallbackSecureUrl ?: BaseUrl;
    /**
     * If we cannot determined whether we should use HTTPS by looking at the response
     * use this value as the default
     */
    fallbackUseSsl ?: boolean;
}

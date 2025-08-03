import { Semaphore } from "data-semaphore";
import * as superagent from 'superagent';
import { UnicastServer } from "./UnicastServer";
import { Singleton } from "./ES2017/Singleton";
import * as fs from 'mz/fs';
import * as sharp from 'sharp';
import { MediaKind } from "./MediaRecord";
import * as path from 'path';

export interface ArtworkCacheOptions {
    width ?: number;
    readCache ?: boolean
}

export function saveStreamTo ( input : NodeJS.ReadableStream, output : NodeJS.WritableStream | string ) : Promise<void> {
    return new Promise<void>( ( resolve, reject ) => {
        if ( typeof output === 'string' ) {
            output = fs.createWriteStream( output );
        }

        input.pipe( output );

        input.on( 'error', reject );

        output.on( 'finish', () => resolve() );

        output.on( 'error', reject );
    } );
}

export class ArtworkCache {
    server : UnicastServer;

    cache : MapCachePersistence<string, string>;

    index : Map<string, [ ArtworkCacheOptions, string ][]> = new Map;

    httpSemaphore : Semaphore = new Semaphore( 5 );

    sharpSemaphore : Semaphore = new Semaphore( 5 );

    constructor ( server : UnicastServer ) {
        this.server = server;

        this.cache = new MapCachePersistence( this.server.storage.getPath( 'cache/artwork.json' ) );
    }

    getCachedRemoteImage ( serverUrl : string, url : string ) : string {
        return `${ serverUrl }/api/media/artwork/scrapers/${ Buffer.from( url, 'utf8' ).toString( 'base64' ) }`;
    }

    getCachedRemoteObject ( serverUrl : string, art : any ) : any {
        const cached : any = {};

        for ( let key of Object.keys( art ) ) {
            if ( typeof art[ key ] === 'string' ) {
                cached[ key ] = this.getCachedRemoteImage( serverUrl, art[ key ] );
            } else if ( art[ key ] && typeof art[ key ] === 'object' ) {
                cached[ key ] = this.getCachedRemoteObject( serverUrl, art[ key ] );
            } else {
                cached[ key ] = art[ key ];
            }
        }

        return cached;
    }

    getCachedObject ( url : string, kind : MediaKind, id : string, art : any, prefix ?: string[] ) {
        const cached : any = {};

        for ( let key of Object.keys( art ) ) {
            if ( typeof art[ key ] === 'string' ) {
                cached[ key ] = `${url}/api/media/artwork/${ kind }/${ id }/${ [ ...(prefix || [] ), key ].join( '.' ) }`;
            } else if ( art[ key ] && typeof art[ key ] === 'object' ) {
                cached[ key ] = this.getCachedObject( url, kind, id, art[ key ], [ ...( prefix || [] ), key ] );
            } else {
                cached[ key ] = art[ key ];
            }
        }

        return cached;
    }

    getCachedScraperObject ( url : string, scraper : string, kind : MediaKind, id : string, art : any, prefix ?: string[] ) {
        const cached : any = {};

        for ( let key of Object.keys( art ) ) {
            if ( typeof art[ key ] === 'string' ) {
                cached[ key ] = `${url}/api/media/artwork/scrapers/${ scraper }/${ kind }/${ encodeURIComponent( id ) }/${ [ ...(prefix || [] ), key ].join( '.' ) }`;
            } else if ( art[ key ] && typeof art[ key ] === 'object' ) {
                cached[ key ] = this.getCachedScraperObject( url, scraper, kind, id, art[ key ], [ ...( prefix || [] ), key ] );
            } else {
                cached[ key ] = art[ key ];
            }
        }

        return cached;
    }

    areOptionsEqual ( a : ArtworkCacheOptions, b : ArtworkCacheOptions ) : boolean {
        return a.width == b.width;
    }

    areOptionsEmpty ( options : ArtworkCacheOptions ) {
        return typeof options.width !== 'number';
    }

    optionsToString ( options : ArtworkCacheOptions ) : string {
        return [ 'width' ].map( prop => prop + '=' + options[ prop ] ).join( ';' );
    }

    getCacheKey ( url : string, options : ArtworkCacheOptions = {} ) : string {
        return `${ url }??${ this.optionsToString( options ) }`;
    }

    getAbsoluteCachedPath( relativeOrAbsolutePath : string ) : string {
        if ( relativeOrAbsolutePath != null && !path.isAbsolute( relativeOrAbsolutePath ) ) {
            return this.server.storage.getPath( relativeOrAbsolutePath );
        }

        return relativeOrAbsolutePath;
    }

    getRelativeCachedPath( relativeOrAbsolutePath : string ) : string {
        if ( relativeOrAbsolutePath != null && path.isAbsolute( relativeOrAbsolutePath ) ) {
            return this.server.storage.getRelativePath( relativeOrAbsolutePath );
        }

        return relativeOrAbsolutePath;
    }

    getCached ( url : string, options : ArtworkCacheOptions = {} ) : string {
        return this.getAbsoluteCachedPath( this.cache.get( this.getCacheKey( url, options ) ) );
    }

    setCached ( url : string, file : string, options : ArtworkCacheOptions = {} ) : void {
        this.cache.set( this.getCacheKey( url, options ), this.getRelativeCachedPath( file ) );
    }

    getReadableStream ( url : string ) : NodeJS.ReadableStream {
        if ( url.startsWith( 'http://' ) || url.startsWith( 'https://' ) ) {
            return superagent.get( url ) as any;
        } else {
            return fs.createReadStream( url );
        }
    }

    @Singleton( ( url : string ) => url )
    async readOriginal ( url : string, readCache : boolean = true ) : Promise<string> {
        let cached;

        if ( ( cached = this.getCached( url ) ) && await fs.exists( cached ) ) {
            if ( readCache ) {
                return cached;
            } else {
                await fs.unlink( cached );
            }
        }

        const cachePath = await this.server.storage.getRandomFile( '', 'jpg', 'cache/artwork/original' );

        const release = await this.httpSemaphore.acquire();

        try {
            const relativeCachePath = path.relative( this.server.storage.getPath( 'cache/artwork' ), cachePath );

            this.server.logger.debug( 'artwork', `Fetching ${url}, saving to ${relativeCachePath}.`, { type: 'fetch' } );

            await saveStreamTo( this.getReadableStream( url ), cachePath );

            this.setCached( url, cachePath );
        } catch ( err ) {
            await this.server.onError.notify( err );
        } finally {
            release();
        }

        return cachePath;
    }

    transform ( image : any, metadata : any, options : ArtworkCacheOptions ) : any {
        image = image.rotate();

        if ( options.width ) {
            const width = options.width;

            const height = Math.ceil( metadata.height / ( metadata.width / width ) );

            image = image.resize( width, height, { kernel: 'lanczos3' } );
        }

        return image;
    }

    @Singleton( function ( url : string, options : ArtworkCacheOptions ) { return this.getCacheKey( url, options ) } )
    async readTransformed ( url : string, options : ArtworkCacheOptions ) : Promise<string> {
        let cached;

        const readCache = options.readCache === void 0 || options.readCache;

        if ( ( cached = this.getCached( url, options ) ) && await fs.exists( cached ) ) {
            if ( readCache ) {
                return cached;
            } else {
                await fs.unlink( cached );
            }
        }

        let cachePath = await this.readOriginal( url, readCache );

        if ( this.areOptionsEmpty( options ) ) {
            return cachePath;
        }

        const release = await this.sharpSemaphore.acquire();

        try {
            const cachePathResized = await this.server.storage.getRandomFile( '', 'jpg', 'cache/artwork/transformed' );

            const relativeCachePath = path.relative( this.server.storage.getPath( 'cache/artwork' ), cachePathResized );

            this.server.logger.debug( 'artwork', `Transforming ${url}, saving to ${ relativeCachePath }.`, { type: 'transform', options } );

            let image = await sharp( cachePath );

            const metadata = await image.metadata();

            const buffer = await this.transform( image, metadata, options ).toFormat( 'jpeg', { quality: 100 } ).toBuffer();

            await fs.writeFile( cachePathResized, buffer );

            this.setCached( url, cachePathResized, options );

            return cachePathResized;
        } catch ( err ) {
            await this.server.onError.notify( err );

            return cachePath;
        } finally {
            release();
        }
    }

    async get ( url : string, options : ArtworkCacheOptions = {} ) : Promise<string> {
        await this.cache.load();

        const cached = await this.readTransformed( url, options );

        await this.cache.save();

        return cached;
    }

    async read ( url : string, options : ArtworkCacheOptions = {} ) : Promise<NodeJS.ReadableStream> {
        return fs.createReadStream( await this.get( url, options ) );
    }
}

export abstract class CachePersistence<T> {
    loaded : boolean = false;

    saved : boolean = true;

    protected loading : Promise<T>;

    protected saving : Promise<void>;

    file : string;

    data : T;

    constructor ( file : string ) {
        this.file = file;
    }

    reload () {
        this.loaded = false;

        return this.load();
    }

    protected async loadNative () : Promise<T> {
        if ( !this.loaded ) {
            if ( await fs.exists( this.file ) ) {
                return this.parse( await fs.readFile( this.file, 'utf8' ) );
            }
        }

        return this.createEmpty();
    }

    async load () {
        if ( this.saving ) {
            await this.saving;
        }

        if ( this.loaded ) {
            return this.data;
        }

        if ( this.loading ) {
            return this.loading;
        }

        return this.loading = this.loadNative().then( done => {
            this.data = done;

            this.loading = null;

            this.loaded = true;

            return done;
        } );
    }

    protected async saveNative ( data : T ) : Promise<void> {
        await fs.writeFile( this.file, this.stringify( data ), 'utf8' );
    }

    async save () : Promise<void> {
        if ( this.loading ) {
            await this.loading;
        }

        if ( this.saved ) {
            return void 0;
        }

        if ( this.saving ) {
            return this.saving;
        }

        return this.saving = this.saveNative( this.data ).then( done => {
            this.saving = null;

            this.saved = true;

            return done;
        } );
    }

    abstract createEmpty () : T;

    abstract parse ( contents : string ) : T;

    abstract stringify ( contents : T ) : string;
}

export class MapCachePersistence<K, V> extends CachePersistence<Map<K, V>> {
    createEmpty () : Map<K, V> {
        return new Map<K, V>();
    }

    parse ( contents : string ) : Map<K, V> {
        const json : [ K, V ][] = JSON.parse( contents );

        return new Map<K, V>( json );
    }

    stringify ( contents : Map<K, V> ) : string {
        return JSON.stringify( Array.from( contents.entries() ) );
    }

    async getAsync ( key : K ) : Promise<V> {
        await this.load();

        return this.get( key );
    }

    get ( key : K ) : V {
        return this.data.get( key );
    }

    has ( key : K ) : boolean {
        return this.data.has( key );
    }

    async hasAsync ( key : K ) : Promise<boolean> {
        await this.load();

        return this.has( key );
    }

    set ( key : K, value : V ) : this {
        this.data.set( key, value );

        this.saved = false;

        return this;
    }

    async setAsync ( key : K, value : V ) : Promise<this> {
        await this.load();

        return this.set( key, value );
    }
}

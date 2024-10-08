import { BaseController, Route } from "../../BaseController";
import { Request, Response, Next } from "restify";
import { NotFoundError } from "restify-errors";
import * as mime from 'mime';
import * as objectPath from 'object-path';
import * as path from 'path';
import * as fs from 'mz/fs';

export class ArtworkController extends BaseController {
    async mkdirp ( folder : string ) {
        if ( !( await fs.exists( folder ) ) ) {
            await this.mkdirp( path.dirname( folder ) );

            await fs.mkdir( folder );
        }
    }

    @Route( [ 'get', 'head' ], '/scrapers/:address', BinaryResponse )
    async getRemoteMedia ( req : Request, res : Response ) : Promise<FileInfo> {
        const address = Buffer.from( req.params.address, 'base64' ).toString( 'utf8' );

        const cachePath : string = await this.server.artwork.get( address, { width: req.query.width ? +req.query.width : null } );

        const stats : fs.Stats = await fs.stat( cachePath );
        
        return {
            mime: mime.getType( cachePath ),
            length: stats.size,
            lastModified: stats.mtime,
            data: fs.createReadStream( cachePath )
        };
    }

    @Route( [ 'get', 'head' ], '/scrapers/:scraper/:kind/:id/:property', BinaryResponse )
    async getForScrapedMedia ( req : Request, res : Response ) : Promise<FileInfo> {
        const scraperName = req.params.scraper;
        const kind = req.params.kind;
        const id = req.params.id;
        const property = req.params.property;
        
        const record = await this.server.scrapers.getMedia( scraperName, kind, id );

        const address : string = objectPath.get( record.art, property );

        if ( address ) {
            const cachePath : string = await this.server.artwork.get( address, { width: req.query.width ? +req.query.width : null } );

            const stats : fs.Stats = await fs.stat( cachePath );
            
            return {
                mime: mime.getType( cachePath ),
                length: stats.size,
                lastModified: stats.mtime,
                data: fs.createReadStream( cachePath )
            };
        } else {
            throw new NotFoundError( `Could not find image "${ address }".` );
        }
    }

    @Route( [ 'get', 'head' ], '/:kind/:id/:property', BinaryResponse )
    async getForStoredMedia ( req : Request, res : Response ) : Promise<FileInfo> {
        const kind = req.params.kind;
        const id = req.params.id;
        const property = req.params.property;
        
        const record = await this.server.media.get( kind, id );

        const address : string = objectPath.get( record.art, property );

        if ( address ) {
            const cachePath : string = await this.server.artwork.get( address, { 
                width: req.query.width ? +req.query.width : null,
                readCache: req.query.readCache === 'true' || req.query.readCache === void 0
            } );

            const stats : fs.Stats = await fs.stat( cachePath );
            
            return {
                mime: mime.getType( cachePath ),
                length: stats.size,
                lastModified: stats.mtime,
                data: fs.createReadStream( cachePath ),
            };
        } else {
            throw new NotFoundError( `Could not find image "${ address }".` );
        }
    }
}

export function BinaryResponse ( controller : any, method : any ) {
    return async function ( req : Request, res : Response, next : Next ) {
        try {
            const file : FileInfo = await controller[ method ]( req, res );

            if ( file ) {
                res.statusCode = 200;
                
                res.set( 'Content-Type', file.mime );
                res.set( 'Content-Length', '' + file.length );
                res.set( 'Last-Modified', '' + file.lastModified.toUTCString() );
                
                ( res as any ).writeHead( 200 );

                if ( req.method.toLowerCase() === 'head' ) {
                    res.end();
                } else {
                    if ( Buffer.isBuffer( file.data ) ) {
                        res.write( file.data );
                    } else {
                        file.data.pipe( res );
                    }
                }
            }

            next();
        } catch ( error ) {
            console.log( error );
            next( error );
        }
    }
}

export interface FileInfo {
    mime : string;
    length : number;
    lastModified : Date;
    data : NodeJS.ReadableStream | Buffer;
}

import { BaseController, RoutesDeclarations, Controller, Route } from "../../BaseController";
import { Request, Response, Next } from "restify";
import * as objectPath from 'object-path';
import * as superagent from 'superagent';
import * as sharp from 'sharp';
import * as mime from 'mime';
import * as path from 'path';
import * as fs from 'mz/fs';
import { Semaphore } from 'await-semaphore';

export class ArtworkController extends BaseController {
    semaphore : Semaphore = new Semaphore( 1 );

    async mkdirp ( folder : string ) {
        if ( !( await fs.exists( folder ) ) ) {
            await this.mkdirp( path.dirname( folder ) );

            await fs.mkdir( folder );
        }
    }

    @Route( 'get', '/:kind/:id/:property', BinaryResponse )
    async list ( req : Request, res : Response ) : Promise<FileInfo> {
        const kind = req.params.kind;
        const id = req.params.id;
        const property = req.params.property;
        
        const storage : string = this.server.config.get( 'storage' );

        const cachePath = path.resolve( process.cwd(), path.join( storage, 'artwork', 'originals', kind, id, property + '.jpg' ) );

        await this.mkdirp( path.dirname( cachePath ) );

        if ( !( await fs.exists( cachePath ) ) ) {
            const record = await this.server.media.get( kind, id );
            
            const address : string = objectPath.get( record.art, property );
                        
            if ( address ) {
                const response = await superagent.get( address );
        
                await fs.writeFile( cachePath, response.body );
            }
        }
        
        if ( req.query.width ) {
            const cachePathResized = path.resolve( process.cwd(), path.join( storage, 'artwork', 'originals', kind, id, property + '-w_' + req.query.width +  '.jpg' ) );

            if ( !( await fs.exists( cachePathResized ) ) ) {
                const release = await this.semaphore.acquire();
                
                try {
                    const image = await sharp( cachePath );
        
                    const metadata = await image.metadata();
        
                    const width = +req.query.width;
        
                    const height = Math.ceil( metadata.height / ( metadata.width / width ) );
        
                    const buffer = await image.resize( width, height ).toFormat( 'jpeg', { quality: 100 } ).toBuffer();
        
                    await fs.writeFile( cachePathResized, buffer );
                } catch ( err ) {
                    console.error( err );
                } finally {
                    release();
                }

                const stats = await fs.stat( cachePathResized );
                
                return {
                    mime: mime.lookup( cachePathResized ),
                    length: stats.size,
                    data: fs.createReadStream( cachePathResized )
                };
            }
        }

        const stats = await fs.stat( cachePath );
        
        return {
            mime: mime.lookup( cachePath ),
            length: stats.size,
            data: fs.createReadStream( cachePath )
        };
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
                
                res.writeHead( 200, res.headers() );

                if ( Buffer.isBuffer( file.data ) ) {
                    res.write( file.data );
                } else {
                    file.data.pipe( res );
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
    data : NodeJS.ReadableStream | Buffer;
}

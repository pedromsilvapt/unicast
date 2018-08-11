import { parseString as xml2js } from 'xml2js';
import * as ytdl from 'ytdl-core';
import * as got from 'got';

export interface YoutubeSubtitleResult {
    url : string;
    language : string;
    translation ?: string;
    format: string;
}

export class SubtitlesDownloader {
    listEndpoint : string = 'https://video.google.com/timedtext?hl=en&type=list';

    // example params: ?lang=en&v=7Pq-S557XQU&fmt=vtt&tlang=pt_PT
    downloadEndpoint : string = 'http://video.google.com/timedtext';

    languages : string[];

    format : string = 'vtt';

    constructor ( languages : string[] = [ 'pt-PT', 'pt-BR', 'pt' ] ) {
        this.languages = languages;
    }

    xml ( contents : string ) : Promise<any> {
        return new Promise( ( resolve, reject ) => {
            try {
                xml2js( contents, ( err, result ) => {
                    if ( err ) {
                        return reject( err );
                    }

                    resolve( result );
                } );
            } catch ( error ) {
                reject( error );
            }
        } );
    }

    findLanguage ( query, languages ) {
        if ( !( query instanceof Array ) ) {
            query = [ query ];
        }

        for ( let langQuery of query ) {
            for ( let language of languages ) {
                if ( language.lang_code == langQuery ) {
                    return language;
                }
            }
        }

        return null;
    }

    match ( video : string, subtitles : YoutubeSubtitleResult[] ) : YoutubeSubtitleResult {
        const id = ytdl.getVideoID( video );

        let result = this.findLanguage( this.languages, subtitles );

        if ( result ) {
            // console.log( result );
            return {
                language: result.lang_code,
                url: `${ this.downloadEndpoint }?lang=${ result.lang_code }&v=${ id }&fmt=${ this.format }`,
                format: this.format
            }
        }

        let englishLanguage = this.findLanguage( [ 'en', 'en-US', 'en-UK' ], subtitles );

        let original = ( englishLanguage || subtitles[ 0 ] ).lang_code;

        // console.log( englishLanguage || subtitles[ 0 ], this.languages[ 0 ] );

        return {
            language: original,
            translation: this.languages[ 0 ],
            url: `${ this.downloadEndpoint }?lang=${ original }&v=${ id }&fmt=${ this.format }&tlang=${ this.languages[ 0 ] }`,
            format: this.format
        };
    }

    async list ( video : string ) : Promise<YoutubeSubtitleResult[]> {
        const id = ytdl.getVideoID( video );

        const response = await got( this.listEndpoint + '&v=' + id );

        const xml = await this.xml( response.body );

        if ( !xml.transcript_list.track ) {
            return [];
        }

        return xml.transcript_list.track.map( o => o.$ );
    }

    async find ( video : string ) : Promise<YoutubeSubtitleResult> {
        const list = await this.list( video );

        return this.match( video, list );
    }

    async fetch ( url : string ) : Promise<string> {
        const response = await got( url );

        return response.body;
    }

    transform ( subtitles : string ) : string {
        return subtitles;
    }

    async download ( video, options = {} ) {
        const source = await this.find( video );

        const subtitles = await this.fetch( source.url );

        return subtitles;
    }
}
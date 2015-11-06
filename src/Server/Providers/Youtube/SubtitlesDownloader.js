import sanitize from 'sanitize-filename';
import { spawn } from 'child_process';
import Download from 'download';
import config from 'config';
import throat from 'throat';
import langs from 'langs';
import Xray from 'x-ray';
import path from 'path';
import got from 'got';
import Qs from 'qs';
import is from 'is';

throat( Promise );

export default class SubtitlesDownloader {

	constructor ( concurrency = 5 ) {
		this.concurrency = concurrency;
		this.serverUrl = config.get( 'providers.youtube.captions.url' );
		this.middlewarePath = config.get( 'providers.youtube.captions.middleware.path' );
	}

	process ( subtitles ) {
		return new Promise( ( resolve, reject ) => {
			let node = spawn( 'node', [ '--harmony', path.basename( this.middlewarePath ), '"1"', '-s', '-p', '-r', config.get( 'providers.youtube.captions.middleware.rule' ) ], {
				cwd: path.dirname( this.middlewarePath )
			} );

			node.stdin.setEncoding( 'utf-8' );
			node.stdin.write( subtitles );
			node.stdin.end();

			let result = '';
			node.stdout.on( 'data', data => {
				result += data;
			} );

			node.stderr.on( 'data', err => {
				reject( err );
			} );

			node.on( 'exit', code => {
				resolve( result )
			} );
		} );
	}

	createLang ( lang, result, automatic ) {
		if ( !is.undef( lang.label ) ) {
			let language = lang.label;
			if ( langs.has( 'name', lang.label ) ) {
				language = langs.where( 'name', lang.label )[ '1' ];
			}

			return {
				label: lang.label,
				language: language,
				link: lang.url,
				automatic: automatic
			};
		} else if ( lang.n ) {
			let link = this.serverUrl + 'index.php?title=' + result.title + '&url=' + encodeURIComponent( lang.url );

			let label = lang.n;
			if ( langs.has( '1', lang.n ) ) {
				label = langs.where( '1', lang.n ).name;
			}

			return {
				label: label,
				language: lang.n,
				link: link,
				automatic: automatic
			};
			//if (typeof obj.lang[i].completion != 'undefined') {
			//	content += ' (' + obj.lang[i].completion + '%)<br>';
			//} else {
			//	content += '<br>';
			//}
		}
	}

	listTransformer ( url, result ) {
		let transformed = {
			url: url,
			title: result.title,
			image: result.image,
			captions: []
		};

		for ( let lang of result.lang ) {
			transformed.captions.push( this.createLang( lang, transformed, false ) );
		}

		for ( let lang of result.autotrans ) {
			transformed.captions.push( this.createLang( lang, transformed, true ) );
		}

		return transformed;
	}

	list ( video ) {
		return got( this.serverUrl + '?url=' + video ).then( ( response ) => {
			try {
				return this.listTransformer( video, JSON.parse( response.body ) );
			} catch ( err ) {
				console.log( response.body );
			}
		} );
	}

	download ( video, options ) {
		options.language = options.language || config.get( 'providers.youtube.captions.language' );

		if ( !( 'middleware' in options ) ) {
			options.middleware = config.get( 'providers.youtube.captions.middleware.active' );
		}

		return this.list( video ).then( ( result ) => {
			let caption = result.captions.filter( ( caption ) => {
				if ( caption.language !== options.language ) {
					return false;
				}

				if ( !options.allowAutomaticCaptions && caption.automatic ) {
					return false;
				}

				if ( options.forceAutomaticCaptions && !caption.automatic ) {
					return false;
				}

				return true;
			} );

			if ( caption.length === 0 ) {
				throw new Error( 'No caption found for the video ' + video );
			}

			caption = caption[ 0 ];

			return got( caption.link ).then( r => r.body ).then( subtitles => {
				if ( options.middleware ) {
					return this.process( subtitles );
				}

				return subtitles;
			} );
		} );
	}

	downloadMultiple ( videos, options ) {
		return Promise.all( videos.map( throat( this.concurrency, ( video ) => {
			return this.download( video, options ).catch( reason => {
				if ( options.ignoreMissing ) {
					return null;
				}

				return Promise.reject( reason );
			} );
		} ) ) );
	}
}

export var LanguagesLabelCodes = {
	'Portuguese': 'pt',
	'English (Automatic Captions)': 'en',
	'English': 'en',
	'Spanish': 'sp'
};


// http://keepsubs.com/subs/youtube.com.php?enc=v21VxcURzqUY1uFjGu8IuU0Qj%2F65Qft%2BNMpmL%2BXQ94zVVLKceZSTBTUpAFoT0DvRUUYxG6wH9eRviKmKr%2Bn9NWnjv%2FOUDTesXESSEnefecipYryxMtX9V%2F0lVJWitg8CtWvsnDLiHWnuqzjseRJd%2F1IUGSfu1DI1H2QyCJYFGCegnpwovTRa%2FdfOe18YJJ0NdMb8XGibhj2n8tqIXkq%2FXXb%2Brk%2F7cXuiyKumXGhUcAKyyvv7xRVNZTeGNFgX3m1LuS9JuE85AxNG67bdEXLAy%2B8VbHxIP8xBC7QpykMfRtcNdsmRxWYS6VIvID%2FZQT7PdGoW8NmMgHZo8KNAbHL599pgyLmRyDgXWjXx7906Gf7EjxowL5NQHyDqCduPW%2BuBhFaXYTL18yyD7Q3zfbiSNUFpOnhxaTr6xGpeHlTpUcA%3D
// http://keepsubs.com/subs/youtube.com.php?enc=v21VxcURzqUY1uFjGu8IuU0Qj%2F65Qft%2BNMpmL%2BXQ94zVVLKceZSTBTUpAFoT0DvRUUYxG6wH9eRviKmKr%2Bn9NWnjv%2FOUDTesXESSEnefecipYryxMtX9V%2F0lVJWitg8C9InU1RUwejHBAXxAmzpIJIARw5KloOn88CPEu1Y46ODhCT3UgY%2B%2FBhloXjF32QaQGyEB618J%2B4jtIJXfSfm45DHWJWxh%2BrQ%2FHlGEb8lLQV%2FzQYMB9nKj1z5R4Z%2FWAZAzNqiK5xpWOj0wB6HHeq%2BgflrTqPb4AEWUUeH5scCW4i0qu8KnMxXA4G2SB8ADS6%2BpMzCnyqva8H%2BtuGqU%2BfnZdSkOHI%2BAan9bfeZ%2FPQabnie3yNTmkeHmG6rSBSuxhUrzm8FnqU1DzrpgisIgHHhgWXcXqiF0dNEunqvROgLUyLQ%3D
// http://keepsubs.com/subs/youtube.com.php?enc=v21VxcURzqUY1uFjGu8IuU0Qj%2F65Qft%2BNMpmL%2BXQ94zVVLKceZSTBTUpAFoT0DvRUUYxG6wH9eRviKmKr%2Bn9NWnjv%2FOUDTesXESSEnefecipYryxMtX9V%2F0lVJWitg8CKQ0BmvUN8yx2ZBErX1cJw3jM%2B9CIGFlXpRZ5YB83woyVzOTJjLss16aq63WnipDlPlFDLQKoHREelsEbYALIa%2FRKSroZ%2FqKgL%2FL1z3mOrmXWUzkBdciSRWcSKZxPgguyBsXtrUaXMIFeRQCa%2BQU9YJhlkCHJvauynTDQIUJW0trqdep2IQFbiRO%2Fuwh8Dr5iOD450UowMECb8xqVGWEUIJ%2B%2F5JZJLFprwLAnn89O58aftivOe0dHWAWcgHqbb24CF69CfcAyZvDHhdNE6XFjWPyrilAcj%2FxIfsMHCgSYI8pyQiYq0TFOysGOrJBGTIh6g2S%2BX95%2BpHvbi1A0%2FOEVdg%3D%3D
// http://keepsubs.com/subs/youtube.com.php?enc=v21VxcURzqUY1uFjGu8IuU0Qj%2F65Qft%2BNMpmL%2BXQ94zVVLKceZSTBTUpAFoT0DvRUUYxG6wH9eRviKmKr%2Bn9NWnjv%2FOUDTesXESSEnefecipYryxMtX9V%2F0lVJWitg8CR94o52wzDVt8cS%2FzWV5LbV%2BA8V1r1GMJQ656DVvx6AG896RAAzjcV8UjRHDOtMDoBhEWIAvAJWwpJhPkSzsbYupwDO5nwqsC49kYZskqI7PzybbprLwQ7HX77r1EIQRaBJ9l0%2FFyT2FXm%2BiEwKq2bgyN1%2BAwUVGoalM%2F%2FfhyzCMoYRq64ItHi1asgqxW08%2FVi65pRg4IWP2nqyVXyeP%2F5CRcYQ%2FAd9N4%2FMBqlBTBvla8KD%2BKnryHAlwrblCAPkzV3Rq519sGV3RJ9hBQ497opf02h6CvtDxps7vfMl%2BtiH6iCF7qdpuq8BwMdIYe5HmWen%2FzNcPwstkBhM0ZLiKn8Q%3D%3D
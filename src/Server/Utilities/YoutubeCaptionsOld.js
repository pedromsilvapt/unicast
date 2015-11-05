import sanitize from 'sanitize-filename';
import Download from 'download';
import throat from 'throat';
import Xray from 'x-ray';
import got from 'got';
import Qs from 'qs';

throat( Promise );

export default class YoutubeCaptions {

	constructor ( concurrency = 5 ) {
		this.concurrency = concurrency;
	}

	listScrapper ( video ) {
		let x = Xray();

		return x( 'http://keepsubs.com/?' + Qs.stringify( { url: video } ), '#dl', {
			url: '#info a.n@href',
			title: '#info a.n',
			image: '#info .m@src',
			time: '#info .q',
			captions: {
				'links': [ 'a.l@href' ],
				'labels': [ '> b' ],
				'separator': 'br + br + b'
			}
		} );
	}

	listTransformer ( resolve, reject, err, result ) {
		if ( err ) {
			return reject( err );
		}

		let labels = result.captions.labels;
		let links = result.captions.links;

		let automaticCaptionsIdentifier = result.captions.separator;
		let automaticCaptionsCount = 0;
		let automaticCaptions = false;

		let captions = [];
		for ( let [ index, link ] of links.entries() ) {
			if ( !automaticCaptions && labels[ index ] == automaticCaptionsIdentifier ) {
				automaticCaptionsCount += 1;

				if ( automaticCaptionsCount == 2 ) {
					automaticCaptions = true;

					labels.splice( index, 1 );
				}
			}

			let language = labels[ index ];
			if ( language in LanguagesLabelCodes ) {
				language = LanguagesLabelCodes[ language ];
			}

			captions.push( {
				label: labels[ index ],
				language: language,
				link: link,
				automatic: automaticCaptions || labels[ index ].indexOf( '(Automatic Captions)' ) !== -1
			} );

		}

		captions.sort( function ( a, b ) {
			if ( a.automatic == b.automatic ) {
				return 0;
			}

			if ( a.automatic ) {
				return 1;
			}

			return -1;
		} );

		result.captions = captions;

		resolve( result );
	}

	list ( video ) {
		return new Promise ( ( resolve, reject ) => {
			try {
				this.listScrapper( video )( this.listTransformer.bind( this, resolve, reject ) );
			} catch ( err ) {
				reject( err );
			}
		} );
	}

	download ( video, options ) {
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

			console.log( result.title, caption.label, caption.language, caption.automatic );

			return got( caption.link );
			//return new Promise( ( resolve, reject ) => {
			//	try {
			//		new .dest( options.destination ).rename( sanitize( result.title + '.srt' ) ).run( ( err, files ) => {
			//			if ( err ) {
			//				return reject( err );
			//			}
			//
			//			resolve( files );
			//		} );
			//	} catch ( err ) {
			//		reject( err );
			//	}
			//} );
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
import Transcoder from './Transcoder';

export default class DTSAudio extends Transcoder {
	valid ( metadata ) {
		let audio = metadata.streams.filter( s => s.codec_type === 'audio' );

		if ( !audio.length ) {
			return false;
		}

		if ( audio[ 0 ].codec_name == 'dca' ) {
			return true;
		}

		return true;
	}

	process ( ffmpeg ) {
		return ffmpeg.videoCodec( 'libx264' ).audioCodec( 'ac3' ).custom( 'af', 'aresample=async=1000' ).format( 'matroska' );
	}
}
import AudioCodec from './Audio';
import extend from 'extend';

export default class DTS extends AudioCodec {
	constructor () {
		super( { codec_name: 'dca' } );
	}
}
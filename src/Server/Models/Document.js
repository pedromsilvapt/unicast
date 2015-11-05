import { Document as CamoDocument } from 'camo';

export default class Document extends CamoDocument {
	toJSON () {
		let json = {};

		let excluded = [ '_schema', '_values', '_meta' ];

		json[ 'id' ] = this.id;

		for ( let key of Object.keys( this ) ) {
			if ( excluded.indexOf( key ) === -1 ) {
				json[ key ] = this[ key ];
			}
		}

		return json;
	}
}
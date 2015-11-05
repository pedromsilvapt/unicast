import path from 'path';
import fs from 'fs-promise';
import moment from 'moment';
import config from 'config';
import sortBy from 'sort-by';
import Controller from './Controller';
import PlaylistsItemsController from './PlaylistsItemsController';
import Playlist from '../Models/Playlist';
import PlaylistItem from '../Models/PlaylistItem';
import DevicesManager from '../../DevicesManager';
import MediaManager from '../../MediaManager';

export default class PlaylistsController extends Controller {
	static routes ( router, make ) {
		let playlists = make();
		let playlistDetails = make();

		playlists.get( '/', this.action( 'list' ) );
		playlists.get( '/last', this.action( 'last' ) );
		playlists.get( '/:playlist', this.action( 'get' ) );
		playlists.post( '/', this.action( 'create' ) );
		playlists.delete( '/', this.action( 'removeAll' ) );
		playlists.delete( '/:playlist', this.action( 'remove' ) );

		PlaylistsItemsController.routes( playlistDetails, make );

		playlists.use( '/:playlist', playlistDetails.routes() );
		router.use( '/playlists', playlists.routes() );
	}

	* list () {
		let device = yield DevicesManager.get( config.get( 'devices.default' ) );

		let playlists = yield Playlist.loadMany( { device: device.name } );

		if ( 'empty' in this.request.query ) {
			let allowEmpty = +this.request.query.empty ? true : false;

			if ( !allowEmpty ) {
				playlists = playlists.filter( p => p.items.length > 0 );
			}
		}

		if ( 'newer_than' in this.request.query ) {
			let newerThan = moment( this.request.query.newer_than );

			playlists = playlists.filter( ( p ) => !moment( p.addedAt ).isBefore( newerThan ) );
		}

		if ( 'older_than' in this.request.query ) {
			let olderThan = moment( this.request.query.older_than );

			playlists = playlists.filter( ( p ) => !moment( p.addedAt ).isAfter( olderThan ) );
		}

		playlists = playlists.sort( sortBy( '-addedAt' ) );

		if ( 'skip' in this.request.query ) {
			playlists = playlists.slice( +this.request.query.skip );
		}

		if ( 'take' in this.request.query ) {
			playlists = playlists.slice( 0, +this.request.query.take );
		}

		return playlists;
	}

	* last () {
		let device = yield DevicesManager.get( config.get( 'devices.default' ) );

		let query = { device: device.name };

		let playlists = yield Playlist.loadMany( query );

		if ( 'empty' in this.request.query ) {
			let allowEmpty = +this.request.query.empty ? true : false;

			if ( !allowEmpty ) {
				playlists = playlists.filter( p => p.items.length > 0 );
			}
		}

		playlists = playlists.sort( sortBy( '-addedAt' ) );

		if ( 'take' in this.request.query ) {
			return playlists.slice( 0, +this.request.query.take );
		}

		return playlists[ 0 ] || null;
    }

	* get () {
		let device = yield DevicesManager.get( config.get( 'devices.default' ) );

		return Playlist.loadOne( { device: device.name, _id: this.params.playlist } );
    }

	* create () {
		let device = yield DevicesManager.get( config.get( 'devices.default' ) );

		let playlist = Playlist.create( {
			device: device.name
		} );

		playlist = yield playlist.save();

		return playlist;
    }

	* remove () {
		let device = yield DevicesManager.get( config.get( 'devices.default' ) );

		let playlist = yield Playlist.loadOne( { device: device.name, _id: this.params.playlist } );

		if ( playlist ) {
			yield playlist.delete();
		}
	}

	* removeAll () {
		let device = yield DevicesManager.get( config.get( 'devices.default' ) );

		let playlists = yield Playlist.loadMany( { device: device.name } );

		for ( let playlist of playlists ) {
			yield playlist.delete();
		}
	}
}
import fs from 'fs-promise';
import path from 'path';
import Controller from './Controller';
import Playlist from '../Models/Playlist';
import PlaylistItem from '../Models/PlaylistItem';
import DevicesManager from '../../DevicesManager';
import MediaManager from '../../MediaManager';

function pad(n, width, z) {
	z = z || '0';
	n = n + '';
	return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
}

export default class PlaylistsItemsController extends Controller {
	static routes ( router, make ) {
		let items = make();

		items.post( '/play', this.action( 'playList' ) );
		items.get( '/', this.action( 'list' ) );
		items.post( '/', this.action( 'create' ) );
		items.get( '/youtube/:video', this.action( 'youtube' ) );
		items.get( '/:item', this.action( 'get' ) );
		items.delete( '/:item', this.action( 'remove' ) );
		items.post( '/:item/play', this.action( 'play' ) );
		items.delete( '/clear', this.action( 'clear' ) );
		items.get( '/previous', this.action( 'getPrevious' ) );
		items.post( '/previous/play', this.action( 'playPrevious' ) );
		items.get( '/current', this.action( 'getCurrent' ) );
		items.get( '/next', this.action( 'getNext' ) );
		items.post( '/next/play', this.action( 'playNext' ) );

		router.use( '/items', items.routes() );
	}

	* list () {
		let device = yield DevicesManager.get( 'ChromeSilvas' );

		let playlist = yield Playlist.loadOne( { device: device.name, _id: this.params.playlist } );

		return playlist.items;
	}

	* get () {
		let device = yield DevicesManager.get( 'ChromeSilvas' );

		let playlist = yield Playlist.loadOne( { device: device.name, _id: this.params.playlist } );

		return playlist.items.filter( item => item && item.id === this.params.item )[ 0 ] || null;
	}

	* playItem ( playlist, item, device ) {
		if ( !item ) {
			playlist.current = null;

			yield playlist.save();

			return device.stop();
		}

		playlist.current = item;

		yield playlist.save();

		return MediaManager.getInstance().play( item, device, this.server );
	}

	* playList () {
		let device = yield DevicesManager.get( 'ChromeSilvas' );

		let playlist = yield Playlist.loadOne( { device: device.name, _id: this.params.playlist } );

		let nextItems = playlist.items.sort( ( a, b ) => a.order - b.order );

		let item = nextItems[ 0 ] || null;

		return yield this.controller.playItem.bind( this )( playlist, item, device );
	}

	* play () {
		let device = yield DevicesManager.get( 'ChromeSilvas' );

		let playlist = yield Playlist.loadOne( { device: device.name, _id: this.params.playlist } );

		let item = playlist.items.filter( item => item && item.id === this.params.item )[ 0 ] || null;

		return yield this.controller.playItem.bind( this )( playlist, item, device );
	}

	* clear () {
		let device = yield DevicesManager.get( 'ChromeSilvas' );

		let playlist = yield Playlist.loadOne( { device: device.name, _id: this.params.playlist } );

		playlist = yield playlist.clear();

		return playlist;
    }

	* youtube () {
		this.request.body.source = 'http://www.youtube.com/watch?v=' + this.params.video;

		let item = yield this.controller.create.bind( this )();

		this.params.item = item.id;

		return yield this.controller.play.bind( this )();
	}

	* create () {
		let device = yield DevicesManager.get( 'ChromeSilvas' );

		let playlist = yield Playlist.loadOne( { device: device.name, _id: this.params.playlist } );

		let item = yield this.server.providers.item( this.request.body.source, playlist, this.request );

		item = PlaylistItem.create( item );

		item = yield item.save();

		playlist.items.push( item );

		playlist = yield playlist.save();

		if ( +this.request.body.autoplay ) {
			yield MediaManager.getInstance().play( item, device, this.server );
		}

		return item;
	}

	* remove () {
		let device = yield DevicesManager.get( 'ChromeSilvas' );

		let playlist = yield Playlist.loadOne( { device: device.name, _id: this.params.playlist } );

		let item = playlist.items.filter( item => item && item.id === this.params.item )[ 0 ] || null;

		playlist.items = playlist.items.filter( i => i && i !== item );

		if ( !item ) {
			return { success: false };
		}

		yield item.delete();

		yield playlist.save();

		return { success: true };
	}

	* getCurrent () {
		let device = yield DevicesManager.get( 'ChromeSilvas' );

		let playlist = yield Playlist.loadOne( { device: device.name, _id: this.params.playlist } );

		return playlist.current;
	}

	* getNext () {
		let device = yield DevicesManager.get( 'ChromeSilvas' );

		let nextItems = yield Playlist.nextItems( { device: device.name, _id: this.params.playlist } );

		//let playlist = yield Playlist.loadOne( { device: device.name, _id: this.params.playlist } );

		return nextItems[ 0 ] || null;
	}

	* playNext () {
		let device = yield DevicesManager.get( 'ChromeSilvas' );

		let playlist = yield Playlist.loadOne( { device: device.name, _id: this.params.playlist } );

		let current = playlist.current;

		if ( !current ) {
			current = { order: -1 };
		}

		let nextItems = playlist.items.filter( i => i && i.order > current.order ).sort( ( a, b ) => a.order - b.order );

		return yield this.controller.playItem.bind( this )( playlist, nextItems[ 0 ] || null, device );
	}

	* getPrevious () {
		let device = yield DevicesManager.get( 'ChromeSilvas' );

		let playlist = yield Playlist.loadOne( { device: device.name, _id: this.params.playlist } );

		let current = playlist.current;

		if ( !current ) {
			current = { order: -1 };
		}

		let previousItems = playlist.items.filter( i => i && i.order < current.order ).sort( ( a, b ) => b.order - a.order );

		return previousItems[ 0 ] || null;
	}

	* playPrevious () {
		let device = yield DevicesManager.get( 'ChromeSilvas' );

		let playlist = yield Playlist.loadOne( { device: device.name, _id: this.params.playlist } );

		let current = playlist.current;

		let previousItems = playlist.items.filter( i => i && ( !current || i.order < current.order ) ).sort( ( a, b ) => b.order - a.order );

		return yield this.controller.playItem.bind( this )( playlist, previousItems[ 0 ] || null, device );
	}
}
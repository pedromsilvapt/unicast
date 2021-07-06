import { isMovieRecord, isTvEpisodeRecord, isTvSeasonRecord, isTvShowRecord, MediaKind, MediaRecord, MovieMediaRecord, TvEpisodeMediaRecord, TvSeasonMediaRecord, TvShowMediaRecord } from '../../../MediaRecord';
import * as Sch from '../../../Config';
import { DeepPartial } from '../../../UnicastServer';
import * as extend from 'extend';
import * as path from 'path';
import * as fs from 'mz/fs';
import * as yaml from 'js-yaml' 

export interface TvShowLocalSettings {
    show?: {
        name?: string,
        id?: string | number;
        override?: DeepPartial<TvShowMediaRecord>,
    },
    seasons?: {
        number: number,
        override?: DeepPartial<TvSeasonMediaRecord>,
    }[],
    episodes?: TvEpisodeLocalSettings[],
}

export interface TvEpisodeLocalSettings {
    file: string,
    id?: string | number,
    override?: DeepPartial<TvEpisodeMediaRecord>,
    ignore?: boolean,
}

export const TvShowLocalSettingsSchema = Sch.object({
    show: Sch.optional({
        name: Sch.optional(String),
        id: Sch.optional(Sch.union(String, Number)),
    }),
    episodes: Sch.optional([
        {
            file: String,
            id: Sch.optional(Sch.union(String, Number)),
            override: Sch.optional(Sch.any()),
            ignore: Sch.optional(Boolean),
        },
    ]),
});

export interface MovieLocalSettings {
    id?: string;
    name?: string;
    year?: number;
    override?: DeepPartial<MovieMediaRecord>
}

export const MovieLocalSettingsSchema = Sch.object({
    id: Sch.optional(String),
    name: Sch.optional(String),
    year: Sch.optional(Number),
    override: Sch.optional(Sch.any())
});

export class LocalSettings {
    static async read<S = MovieLocalSettings | TvShowLocalSettings> ( filePath: string ): Promise<S> {
        try {
            const fileContents = await fs.readFile( filePath, { encoding: 'utf-8' } );
    
            return yaml.load( fileContents );
        } catch {
            return null;
        }
    }

    static async write ( filePath : string, localSettings : MovieLocalSettings | TvShowLocalSettings ) : Promise<void> {
        const fileContents = yaml.dump( localSettings, { indent: 4 } );
        
        await fs.writeFile( filePath, fileContents, { encoding: 'utf-8' } );
    }

    static getEpisodeLocalSettings ( episode: TvEpisodeMediaRecord, showSettings: TvShowLocalSettings, settingsPath: string = null ): TvEpisodeLocalSettings {
        return this.getEpisodeFileLocalSettings( episode.sources[ 0 ].id, showSettings, settingsPath );
    }

    static getEpisodeFileLocalSettings ( episodePath: string, showSettings: TvShowLocalSettings, settingsPath: string = null ): TvEpisodeLocalSettings {
        const settingsFolderPath = path.dirname( settingsPath );

        return showSettings.episodes
            ?.find( episode => isSameFile( settingsFolderPath, episodePath, episode.file ) );
    }

    static getLocalSettingsCustomization<R extends MediaRecord> ( record: R, localSettings: any, settingsPath: string = null ): DeepPartial<R> {
        if ( isMovieRecord( record ) ) {
            const movieSettings = localSettings as MovieLocalSettings;

            return movieSettings.override as DeepPartial<R>;
        } else if ( isTvShowRecord( record ) ) {
            const showSettings = localSettings as TvShowLocalSettings;
            
            return showSettings.show?.override as DeepPartial<R>;
        } else if ( isTvSeasonRecord( record ) ) {
            const showSettings = localSettings as TvShowLocalSettings;
            
            return showSettings.seasons
                ?.find( season => season.number == record.number )
                ?.override as any;
        } else if ( isTvEpisodeRecord( record ) ) {
            const showSettings = localSettings as TvShowLocalSettings;

            return this.getEpisodeLocalSettings( record, showSettings, settingsPath )?.override as any;
        }

        return null;
    }

    static getMergedCustomization<R extends MediaRecord> ( record: R, localSettings: any[], paths?: string[] ): DeepPartial<R> {
        const customization: DeepPartial<R> = {};

        for ( const [index, setting] of localSettings.entries() ) {
            const override = this.getLocalSettingsCustomization( record, setting, paths?.[index] );

            if ( override ) {
                extend( true, customization, override );
            }
        }

        return customization;
    }
    
    static setLocalSettingsCustomization<R extends MediaRecord> ( record : R, localSettings: any, customization: DeepPartial<R>, settingsPath: string = null, override : boolean = false ) : any {        
        if ( override === false ) {
            const currentCustomization = LocalSettings.getLocalSettingsCustomization( record, localSettings, settingsPath );

            customization = extend( true, {}, currentCustomization, customization );
        }

        if ( isMovieRecord( record ) ) {
            const movieSettings = localSettings as MovieLocalSettings;

            movieSettings.override = customization as any;
        } else if ( isTvShowRecord( record ) ) {
            const showSettings = localSettings as TvShowLocalSettings;
            
            if ( showSettings.show == null ) {
                showSettings.show = {};
            }

            showSettings.show.override = customization as any;
        } else if ( isTvSeasonRecord( record ) ) {
            const showSettings = localSettings as TvShowLocalSettings;
            
            if ( showSettings.seasons == null ) {
                showSettings.seasons = [];
            }

            let seasonSettings = showSettings.seasons
                ?.find( season => season.number == record.number );

            if ( seasonSettings == null ) {
                seasonSettings = { number: record.number };

                showSettings.seasons.push( seasonSettings );
            }

            seasonSettings.override = customization as any;
        } else if ( isTvEpisodeRecord( record ) ) {
            const settingsFolderPath = path.dirname( settingsPath );

            const episodePath = record.sources[ 0 ].id;

            const showSettings = localSettings as TvShowLocalSettings;

            if ( showSettings.episodes == null ) {
                showSettings.episodes = [];
            }

            let episodeSettings = showSettings.episodes
                .find( episode => isSameFile( settingsFolderPath, episodePath, episode.file ) );

            if ( episodeSettings == null ) {
                episodeSettings = { file: path.relative( settingsFolderPath, episodePath ) };

                showSettings.episodes.push( episodeSettings );
            }

            episodeSettings.override = customization as any;
        }
    }

}

export function isSameFile ( baseFolder : string, file1 : string, file2 : string ) : boolean {
    if ( !path.isAbsolute( file1 ) ) file1 = path.resolve( baseFolder, file1 );
    if ( !path.isAbsolute( file2 ) ) file2 = path.resolve( baseFolder, file2 );
    
    return file1 == file2;
}
declare module "opensubtitles.com" {
    export interface Settings {
        apikey: string;
        endpoint?: string;
    }

    export interface InfosEndpoint {
        formats (): Promise<unknown>;

        user (): Promise<unknown>;

        languages (): Promise<unknown>;
    }

    export interface UserEndpoint {
        login (options: LoginOptions): Promise<LoginResponse>;

        logout (): Promise<unknown>;
    }

    export interface DiscoverEndpoint {
        popular (options: DiscoverOptions): Promise<DiscoverPopularResponse>;

        latest (options: DiscoverOptions): Promise<DiscoverResponse>;

        most_downloaded (options: DiscoverOptions): Promise<DiscoverResponse>;
    }

    export interface LoginOptions {
        username: string;
        password: string;
    }

    export interface LoginResponse {
        user: {
            allowed_translations: number;
            allowed_downloads: number;
            level: string;
            user_id: number;
            ext_installed: boolean;
            vip: boolean;
        };
        base_url: string;
        token: string;
        status: number;
    }

    export interface DiscoverOptions {
        /**
         * Language code(s), coma separated (en,fr) or "all"
         */
        languages: string;

        /**
         * Type (movie or tvshow)
         */
        type: string;
    }

    export interface SubtitleFile {
        file_id: number;
        cd_number: number;
        file_name: string;
    }

    export interface Subtitle {
        id: string;
        type: string;
        attributes: {
            subtitle_id: string;
            language: string;
            download_count: number;
            new_download_count: number;
            hearing_impaired: boolean;
            hd: boolean;
            fps: number;
            votes: number;
            points: number;
            ratings: number;
            from_trusted: boolean;
            foreign_parts_only: boolean;
            ai_translated: boolean;
            machine_translated: boolean;
            upload_date: string;
            release: string;
            comments: string;
            legacy_subtitle_id: number;
            uploader: {
                upload_id: number;
                name: string;
                rank: string;
            };
            feature_details: {
                feature_id: number;
                feature_type: string;
                year: number;
                title: string;
                movie_name: string;
                imdb_id: number;
                tmdb_id: number;
            };
            url: string;
            related_links: unknown[];
            files: SubtitleFile[];
        };
    }

    export interface DiscoverPopularResponse extends Subtitle {

    }

    export interface DiscoverResponse {
        total_pages: number;
        total_count: number;
        page: number;
        data: Subtitle[];
    }

    export interface DownloadOptions {
        file_id: number;
        sub_format?: string;
        file_name?: string;
        in_fps?: number;
        out_fps?: number;
        timeshift?: number;
        force_download?: boolean;
    }

    export interface DownloadResponse {
        link: string;
        file_name: string;
        requests: number;
        remaining: number;
        message: string;
        reset_time: string;
        reset_time_utc: string;
    }

    export interface SubtitlesOptions {
        ai_translated?: 'include' | 'exclude';
        episode_number?: number;
        foreign_parts_only?: 'include' | 'exclude';
        hearing_impaired?: 'include' | 'exclude';
        /**
         * ID of the movie or episode
         */
        id?: number;
        /**
         * IMDB ID of the movie or episode
         */
        imdb_id?: number;
        /**
         * Language code(s), comma separated, sorted in alphabetical order (en,fr)
         */
        languages?: string;
        machine_translated?: 'include' | 'exclude';
        /**
         * Moviehash of the moviefile (length of 16 characters)
         */
        moviehash?: string;
        moviehash_match?: 'include' | 'exclude';
        order_by?: 'language' | 'download_count' | 'new_download_count' | 'hearing_impaired'
                 | 'hd' | 'fps' | 'votes' | 'points' | 'ratings' | 'from_trusted'
                 | 'foreign_parts_only' | 'ai_translated' | 'machine_translated'
                 | 'upload_date' | 'release' | 'comments';
        order_direction?: 'asc' | 'desc';
        page?: number;
        /**
         * For Tvshows
         */
        parent_feature_id?: number;
        /**
         * For Tvshows
         */
        parent_imdb_id?: number;
        /**
         * For Tvshows
         */
        parent_tmdb_id?: number;
        /**
         * File name or text search
         */
        query?: string;
        /**
         * For Tvshows
         */
        season_number?: number;
        /**
         * TMDB ID of the movie or episode
         */
        tmdb_id?: number;
        trusted_sources?: 'include' | 'exclude';
        type?: 'movie' | 'episode' | 'all';
        /**
         * To be used alone - for user uploads listing
         */
        uploader_id?: number;
        /**
         * Filter by movie/episode year
         */
        year?: number;
    }

    export interface SubtitlesResponse {
        total_pages: number;
        total_count: number;
        page: number;
        data: Subtitle[];
    }

    export class Endpoint {
        readonly infos: InfosEndpoint;

        readonly user: UserEndpoint;

        readonly discover: DiscoverEndpoint;

        download (options: DownloadOptions): Promise<DownloadResponse>;

        subtitles (options: SubtitlesOptions): Promise<SubtitlesResponse>;

        features (options: unknown): Promise<unknown>;

        guessit (options: unknown): Promise<unknown>;
    }

    export class OS extends Endpoint {
        constructor (settings: Settings);

        login (options: LoginOptions): Promise<LoginResponse>;

        logout (): Promise<void>;
    }

    export = OS;
}

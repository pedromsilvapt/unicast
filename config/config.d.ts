export default interface Config {
    name: string;
    storage: string;

    primaryLanguage: string;
    secondaryLanguages: string[];

    server: {
        port: number
    };
    
    ssl: {
        enabled: boolean;
        key: string;
        certificate: string;
        passphrase: string;
        port: number;
    };

    database: {
        db: string;
        host: string;
        port: number
    };

    receivers: {
        scan: boolean
        default: boolean
        list: {
            name: string;
            type: string;

            [ other : string ] : any;
        }[]
    }[];

    providers: {
        name: string;
        type: string;

        [ other : string ] : any;
    }[];

    ffmpeg: {
        path: string;
        externalFilterScripts?: boolean;
        /** SSH options used when running commands on remote mounts (see `remote` on file system mounts) */
        remote?: {
            /** Seconds, defaults to 10 */
            connectTimeout?: number;
            /** Seconds to keep the shared ssh connection open (0 disables multiplexing), defaults to 60 */
            controlPersist?: number;
            /** Folder for the ssh control sockets, defaults to <tmpdir>/unicast-ssh */
            controlPath?: string;
        };
    };

    mpv: {
        path: string;
        command: string;
        args ?: string[];
    }
}
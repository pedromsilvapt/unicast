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
    };

    mpv: {
        path: string;
        cmd: string;
        args ?: string[];
    }
}
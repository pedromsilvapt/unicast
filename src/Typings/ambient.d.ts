declare namespace NodeJS {
    declare interface ProcessPkg {
        entrypoint : string;
        
        defaultEntrypoint : string;

        mount ( internal : string, external : string ) : void;
    }

    declare interface Process {
        pkg ?: ProcessPkg;
    }

    declare interface ProcessVersions {
        pkg ?: string;
    }
}

declare module "module" {
    var Module : any;
    
    export = Module;
}
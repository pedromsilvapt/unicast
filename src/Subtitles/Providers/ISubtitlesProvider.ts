import { PlayableMediaRecord } from "../../MediaRecord";
import { IEntity } from "../../EntityFactory";

export interface ISubtitle {
    id: string;
    releaseName : string;
    encoding : string;
    format : string;
    language : string;
    publishedAt : Date;
    downloads : number;
    provider : string;
    score : number;
}

export interface ISubtitlesProvider<S extends ISubtitle = ISubtitle> extends IEntity {
    readonly name : string;

    search ( media : PlayableMediaRecord, lang : string ) : Promise<S[]>;

    download ( subtitle : S ) : Promise<NodeJS.ReadableStream>;
}
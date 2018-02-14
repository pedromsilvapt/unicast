export interface IVideoPlayerController {
    play ( video : string, subtitles : string ) : Promise<void>;
}
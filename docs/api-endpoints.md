# API Endpoints Reference

## Table of Contents

- [ApiController](#apicontroller)
- [CustomActionsController](#customactionscontroller)
- [PlayerController](#playercontroller)
- [PlaylistsController](#playlistscontroller)
- [TasksController](#taskscontroller)
- [UserRanksController](#userrankscontroller)
- [ArtworkController](#artworkcontroller)
- [CollectionsController](#collectionscontroller)
- [CustomController](#customcontroller)
- [MediaController (MediaTableController)](#mediacontroller-mediatablecontroller)
- [MoviesController](#moviescontroller)
- [PeopleController](#peoplecontroller)
- [ProvidersController](#providerscontroller)
- [RepositoriesController](#repositoriescontroller)
- [ScrapersController](#scraperscontroller)
- [SessionsController](#sessionscontroller)
- [StorageController](#storagecontroller)
- [SubtitlesController](#subtitlescontroller)
- [TvEpisodesController](#tvepisodescontroller)
- [TvSeasonsController](#tvseasonscontroller)
- [TvShowsController](#tvshowscontroller)

---

## ApiController

**Base path:** `/api`

### `GET /api/ping`

Health-check endpoint. Returns server liveness, current timestamp, and the caller's identity.

|               | Type                                                  |
| ------------- | ----------------------------------------------------- |
| **Query**     | None                                                  |
| **Body**      | None                                                  |
| **Response**  | `{ alive: boolean, now: number, identity: AccessCard }` |

### `GET /api/speedtest`

Returns a binary stream of random data to test download throughput.

|               | Type                                                    |
| ------------- | ------------------------------------------------------- |
| **Query**     | None                                                    |
| **Body**      | None                                                    |
| **Response**  | `FileInfo` (`{ mime?: string, length?: number, data: NodeJS.ReadableStream \| Buffer }`) |

### `POST /api/execute-tool/:name`

Executes a named server-side tool with options in the request body.

|               | Type                                               |
| ------------- | --------------------------------------------------- |
| **Query**     | None                                                |
| **Body**      | `{ options: any }`                                  |
| **Response**  | `{ success: boolean }`                              |

Path param: `name: string`

### `GET /api/sitemap`

Returns a sorted list of all registered HTTP routes with method, path, and validation schemas.

|               | Type                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| **Query**     | None                                                                                                          |
| **Body**      | None                                                                                                          |
| **Response**  | `Array<{ method: string, path: string, querySchema?: string, bodySchema?: string, description?: string }>` |

### `GET /api/close`

Initiates server shutdown after a 1-second grace period.

|               | Type  |
| ------------- | ----- |
| **Query**     | None  |
| **Body**      | None  |
| **Response**  | None  |

### Sub-controllers mounted under `/api`

| Controller                | Mount Path              |
| ------------------------- | ----------------------- |
| `TasksController`           | `/api/tasks`              |
| `PlayerController`          | `/api/player`             |
| `MoviesController`          | `/api/media/movie`        |
| `TvShowsController`         | `/api/media/show`         |
| `TvSeasonsController`       | `/api/media/season`       |
| `TvEpisodesController`      | `/api/media/episode`      |
| `CustomController`          | `/api/media/custom`       |
| `PeopleController`          | `/api/media/people`       |
| `CollectionsController`     | `/api/media/collection`   |
| `ArtworkController`         | `/api/media/artwork`      |
| `SubtitlesController`       | `/api/media/subtitles`    |
| `ProvidersController`       | `/api/media/providers`    |
| `RepositoriesController`    | `/api/media/repositories` |
| `SessionsController`        | `/api/media/sessions`     |
| `ScrapersController`        | `/api/media/scrapers`     |
| `UserRanksController`       | `/api/media/user-ranks`   |
| `StorageController`         | `/api/storage`            |
| `CustomActionsController`   | `/api/custom-actions`     |

---

## CustomActionsController

**Base path:** `/api/custom-actions`

### `GET /api/custom-actions/`

Lists all registered custom actions, grouped by their button group name.
Actions appear in the order they were registered in the config file.

|               | Type                  |
| ------------- | --------------------- |
| **Query**     | None                  |
| **Body**      | None                  |
| **Response**  | `CustomActionGroup[]` |

```ts
interface CustomActionGroup {
    name: string;
    actions: CustomActionButton[];
}
interface CustomActionButton {
    name: string;
    label: string;
    icon: string;
    group?: string;
}
```

### `POST /api/custom-actions/execute/:name`

Executes the custom action identified by `:name`. Passes optional `context` from the body.

|               | Type                                |
| ------------- | ----------------------------------- |
| **Query**     | None                                |
| **Body**      | `{ context?: CustomActionContext }` |
| **Response**  | `CustomActionResult`                |

```ts
interface CustomActionContext { device?: { name: string } }
type CustomActionResult = { kind: 'success' | 'error' | 'info' | 'warning'; message: string };
```

---

## PlayerController

**Base path:** `/api/player`

### `GET /api/player/list`

Lists all available receiver devices, filtered by access control and sorted by type and name.

|               | Type                  |
| ------------- | --------------------- |
| **Query**     | None                  |
| **Body**      | None                  |
| **Response**  | `ReceiverJSON[]`      |

### `GET /api/player/:device`

Gets the details of a specific receiver device by its name.

|               | Type             |
| ------------- | ---------------- |
| **Query**     | None             |
| **Body**      | None             |
| **Response**  | `ReceiverJSON`   |

### `GET|POST /api/player/:device/play/next`

Plays the next media item in the session queue for the given device.

|               | Type                    |
| ------------- | ----------------------- |
| **Query**     | `{ strategy?: string }` |
| **Body**      | None                    |
| **Response**  | `ReceiverStatus`        |

### `GET|POST /api/player/:device/play/previous`

Plays the previous media item in the session queue for the given device.

|               | Type                    |
| ------------- | ----------------------- |
| **Query**     | `{ strategy?: string }` |
| **Body**      | None                    |
| **Response**  | `ReceiverStatus`        |

### `GET /api/player/:device/preview/next`

Previews the next media item without playing it.

|               | Type                                              |
| ------------- | ------------------------------------------------- |
| **Query**     | `{ strategy?: string }`                           |
| **Body**      | None                                              |
| **Response**  | `{ record: MediaRecord \| null, options: MediaPlayOptions \| null }` |

### `GET /api/player/:device/preview/previous`

Previews the previous media item without playing it.

|               | Type                                              |
| ------------- | ------------------------------------------------- |
| **Query**     | `{ strategy?: string }`                           |
| **Body**      | None                                              |
| **Response**  | `{ record: MediaRecord \| null, options: MediaPlayOptions \| null }` |

### `GET|POST /api/player/:device/play/media/:kind/:id`

Plays a specific media item identified by kind and ID, with optional play options.

|               | Type                                                                                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Query**     | None                                                                                                                                                              |
| **Body**      | `{ playlistId?: string, playlistPosition?: number, startTime?: number \| string, autostart?: boolean \| string, subtitlesOffset?: number \| string, transcoding?: any }` |
| **Response**  | `ReceiverStatus`                                                                                                                                                  |

### `GET|POST /api/player/:device/play`

Plays media from a list of source details provided in the body.

|               | Type                            |
| ------------- | ------------------------------- |
| **Query**     | None                            |
| **Body**      | `{ sources: MediaSourceDetails[] }` |
| **Response**  | `ReceiverStatus`                |

### `GET|POST /api/player/:device/pause`

Pauses playback on the specified device.

|               | Type             |
| ------------- | ---------------- |
| **Query**     | None             |
| **Body**      | None             |
| **Response**  | `ReceiverStatus` |

### `GET|POST /api/player/:device/resume`

Resumes playback on the specified device.

|               | Type             |
| ------------- | ---------------- |
| **Query**     | None             |
| **Body**      | None             |
| **Response**  | `ReceiverStatus` |

### `GET|POST /api/player/:device/stop`

Stops playback on the specified device.

|               | Type             |
| ------------- | ---------------- |
| **Query**     | None             |
| **Body**      | None             |
| **Response**  | `ReceiverStatus` |

### `GET|POST /api/player/:device/disconnect`

Disconnects from the specified device.

|               | Type                 |
| ------------- | -------------------- |
| **Query**     | None                 |
| **Body**      | None                 |
| **Response**  | `{ success: boolean }` |

### `GET|POST /api/player/:device/reconnect`

Reconnects to the specified device.

|               | Type                 |
| ------------- | -------------------- |
| **Query**     | None                 |
| **Body**      | None                 |
| **Response**  | `{ success: boolean }` |

### `GET|POST /api/player/:device/turnoff`

Turns off the specified device.

|               | Type             |
| ------------- | ---------------- |
| **Query**     | None             |
| **Body**      | None             |
| **Response**  | `ReceiverStatus` |

### `GET /api/player/:device/status`

Gets the current playback status of the specified device.

|               | Type             |
| ------------- | ---------------- |
| **Query**     | None             |
| **Body**      | None             |
| **Response**  | `ReceiverStatus` |

### `POST /api/player/:device/seek/:time`

Seeks relative to the current position by the given time offset (seconds).

|               | Type             |
| ------------- | ---------------- |
| **Query**     | None             |
| **Body**      | None             |
| **Response**  | `ReceiverStatus` |

### `POST /api/player/:device/seek-to/:time`

Seeks to an absolute playback position (seconds).

|               | Type             |
| ------------- | ---------------- |
| **Query**     | None             |
| **Body**      | None             |
| **Response**  | `ReceiverStatus` |

### `POST /api/player/:device/mute`

Mutes the specified device.

|               | Type             |
| ------------- | ---------------- |
| **Query**     | None             |
| **Body**      | None             |
| **Response**  | `ReceiverStatus` |

### `POST /api/player/:device/unmute`

Unmutes the specified device.

|               | Type             |
| ------------- | ---------------- |
| **Query**     | None             |
| **Body**      | None             |
| **Response**  | `ReceiverStatus` |

### `POST /api/player/:device/volume/:volume`

Sets the volume level on the specified device.

|               | Type             |
| ------------- | ---------------- |
| **Query**     | None             |
| **Body**      | None             |
| **Response**  | `ReceiverStatus` |

### `POST /api/player/:device/subtitles-size/:size`

Changes the subtitles font size on the specified device.

|               | Type             |
| ------------- | ---------------- |
| **Query**     | None             |
| **Body**      | None             |
| **Response**  | `ReceiverStatus` |

### `GET|POST /api/player/:device/command/:command`

Executes a custom command on the device. Command name is camel-cased.

|               | Type              |
| ------------- | ----------------- |
| **Query**     | `{ args?: any[] }` |
| **Body**      | `{ args?: any[] }` |
| **Response**  | `ReceiverStatus`   |

### `GET /api/player/:device/preview/:kind/:id/:time`

Generates a preview image (thumbnail) for a media item at the given time position.

|               | Type                                                    |
| ------------- | ------------------------------------------------------- |
| **Query**     | `{ width?: number, height?: number }`                   |
| **Body**      | None                                                    |
| **Response**  | `FileInfo` (binary response)                            |

---

## PlaylistsController

**Base path:** `/api/player/:device/playlists`

### `GET /api/player/:device/playlists`

List all playlists for a device with optional sorting, filtering, and pagination.
If `items=true`, each playlist's media items are included.

|               | Type                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------- |
| **Query**     | `RequestQuery<PlaylistRecord> & { items?: string }`                                                 |
| **Body**      | None                                                                                                |
| **Response**  | `PlaylistRecord[]`                                                                                  |

### `GET /api/player/:device/playlists/:id`

Retrieve a single playlist by its ID.

|               | Type              |
| ------------- | ----------------- |
| **Query**     | None              |
| **Body**      | None              |
| **Response**  | `PlaylistRecord`  |

### `POST /api/player/:device/playlists`

Create a new playlist. The `device` field is set from the URL parameter.

|               | Type                                |
| ------------- | ----------------------------------- |
| **Query**     | None                                |
| **Body**      | `Omit<PlaylistRecord, "device">`   |
| **Response**  | `PlaylistRecord`                    |

### `POST /api/player/:device/playlists/:id`

Update an existing playlist by its ID.

|               | Type                                         |
| ------------- | -------------------------------------------- |
| **Query**     | None                                         |
| **Body**      | `Partial<Omit<PlaylistRecord, "device">>`    |
| **Response**  | `PlaylistRecord`                             |

### `DELETE /api/player/:device/playlists/:id`

Delete a playlist by its ID.

|               | Type                 |
| ------------- | -------------------- |
| **Query**     | None                 |
| **Body**      | None                 |
| **Response**  | `{ success: boolean }` |

### `GET /api/player/:device/playlists/last`

Retrieve the most recently created playlist. Optionally exclude empty playlists.

|               | Type                       |
| ------------- | -------------------------- |
| **Query**     | `{ empty?: "exclude" }`    |
| **Body**      | None                       |
| **Response**  | `PlaylistRecord \| null`   |

### `GET /api/player/:device/playlists/:id/items`

Retrieve all media items belonging to a specific playlist.

|               | Type             |
| ------------- | ---------------- |
| **Query**     | None             |
| **Body**      | None             |
| **Response**  | `MediaRecord[]`  |

### `POST /api/player/:device/playlists/:id/items`

Replace (sync) the media items of a playlist.

|               | Type                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------- |
| **Query**     | None                                                                                           |
| **Body**      | `Array<{ kind: string; id: string } \| { sources: MediaSourceLike; id?: undefined }>`          |
| **Response**  | `MediaRecord[]`                                                                                |

`MediaSourceLike = string | MediaSourceDetails | (string | MediaSourceDetails)[]`

---

## TasksController

**Base path:** `/api/tasks`

### `GET /api/tasks/`

List all registered tasks, optionally filtered by state or type.
`metricsHistory` controls whether metric history points are included.

|               | Type                                                        |
| ------------- | ----------------------------------------------------------- |
| **Query**     | `{ state?: string; type?: string; metricsHistory?: string }` |
| **Body**      | None                                                        |
| **Response**  | `BackgroundTaskJSON[]`                                      |

```ts
interface BackgroundTaskJSON {
    id: string;
    state: BackgroundTaskState;
    startedAt: number | null;
    startedAtHuman: string | null;
    metadata: any;
    done: number;
    total: number;
    elapsedTime: number;
    remainingTime: number;
    errors: any[];
    metrics: Array<{
        name: string; minimum: number; maximum: number; debounceTime: number;
        now: number; memory: number;
        lastPoint: [number, number, string, any] | null;
        points: Array<[number, number, string, any]>;
    }>;
    cancelable: boolean;
    pausable: boolean;
}
```

### `GET /api/tasks/:id`

Retrieve a single task by its ID.

|               | Type                                          |
| ------------- | --------------------------------------------- |
| **Query**     | `{ filter?: unknown; metricsHistory?: string }` |
| **Body**      | None                                          |
| **Response**  | `BackgroundTaskJSON`                          |

### `POST /api/tasks/:id/stop`

Cancel/stop a running task by setting its state to cancelled.

|               | Type                 |
| ------------- | -------------------- |
| **Query**     | None                 |
| **Body**      | None                 |
| **Response**  | `BackgroundTaskJSON` |

---

## UserRanksController

**Base path:** `/api/media/user-ranks`

```ts
type MediaRecordReference = { id: string; kind: MediaKind };
type MediaKind = 'movie' | 'show' | 'season' | 'episode' | 'custom';
```

### `GET /api/media/user-ranks/:listId/`

Retrieves all records from the specified user rank list.

|               | Type                       |
| ------------- | -------------------------- |
| **Query**     | None                       |
| **Body**      | None                       |
| **Response**  | `MediaRecordReference[]`   |

### `DELETE /api/media/user-ranks/:listId/`

Truncates (empties) the specified user rank list.

|               | Type  |
| ------------- | ----- |
| **Query**     | None  |
| **Body**      | None  |
| **Response**  | `void` |

### `POST /api/media/user-ranks/:listId/set-rank-before`

Positions records before the anchor. If no anchor, records go to the bottom.

|               | Type                                                         |
| ------------- | ------------------------------------------------------------ |
| **Query**     | None                                                         |
| **Body**      | `{ anchor?: MediaRecordReference; records: MediaRecordReference[] }` |
| **Response**  | `void`                                                       |

### `POST /api/media/user-ranks/:listId/set-rank-after`

Positions records after the anchor. If no anchor, records go to the top.

|               | Type                                                         |
| ------------- | ------------------------------------------------------------ |
| **Query**     | None                                                         |
| **Body**      | `{ anchor?: MediaRecordReference; records: MediaRecordReference[] }` |
| **Response**  | `void`                                                       |

### `GET /api/media/user-ranks/:listId/consistency`

Checks the consistency/integrity of the specified user rank list.

|               | Type       |
| ------------- | ---------- |
| **Query**     | None       |
| **Body**      | None       |
| **Response**  | `unknown`  |

---

## ArtworkController

**Base path:** `/api/media/artwork`

### `GET|HEAD /api/media/artwork/scrapers/:address`

Fetches a remote artwork image by its base64-encoded address. Streams back as binary.

|               | Type                    |
| ------------- | ----------------------- |
| **Query**     | `{ width?: number }`    |
| **Body**      | None                    |
| **Response**  | `FileInfo` (binary)     |

### `GET|HEAD /api/media/artwork/scrapers/:scraper/:kind/:id/:property`

Retrieves artwork for a media item from a scraper. Streams cached image as binary.

|               | Type                    |
| ------------- | ----------------------- |
| **Query**     | `{ width?: number }`    |
| **Body**      | None                    |
| **Response**  | `FileInfo` (binary)     |

### `GET|HEAD /api/media/artwork/:kind/:id/:property`

Retrieves artwork for a locally stored media item. Streams cached image as binary.

|               | Type                                     |
| ------------- | ---------------------------------------- |
| **Query**     | `{ width?: number, readCache?: boolean }` |
| **Body**      | None                                     |
| **Response**  | `FileInfo` (binary)                      |

```ts
interface FileInfo {
    mime: string;
    length: number;
    lastModified: Date;
    data: NodeJS.ReadableStream | Buffer;
}
```

---

## CollectionsController

**Base path:** `/api/media/collection`

```ts
interface CollectionRecord extends BaseRecord, TimestampedRecord {
    parentId?: string;
    title: string;
    color: string;
    kinds: string[];
    primary: boolean;
}
interface CollectionTreeRecord extends CollectionRecord {
    children?: CollectionTreeRecord[];
}
```

### `GET /api/media/collection/`

List all collections. Supports filtering by `kind`, and can include items or return a tree structure.

|               | Type                                                                                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Query**     | `{ skip?: number; take?: number; filterSort?: string \| { field: string; direction?: "asc" \| "desc"; list?: string }; kind?: string; items?: string; tree?: string; search?: string }` |
| **Body**      | None                                                                                                                                                                 |
| **Response**  | `CollectionRecord[]` (or `CollectionTreeRecord[]` when `tree=true`)                                                                                                 |

### `GET /api/media/collection/:id`

Get a single collection by its ID.

|               | Type                |
| ------------- | ------------------- |
| **Query**     | None                |
| **Body**      | None                |
| **Response**  | `CollectionRecord`  |

### `POST /api/media/collection/`

Create a new collection.

|               | Type                |
| ------------- | ------------------- |
| **Query**     | None                |
| **Body**      | `CollectionRecord`  |
| **Response**  | `CollectionRecord`  |

### `POST /api/media/collection/:id`

Update an existing collection by its ID.

|               | Type                          |
| ------------- | ----------------------------- |
| **Query**     | None                          |
| **Body**      | `Partial<CollectionRecord>`   |
| **Response**  | `CollectionRecord`            |

### `DELETE /api/media/collection/:id`

Delete a collection by its ID.

|               | Type                 |
| ------------- | -------------------- |
| **Query**     | None                 |
| **Body**      | None                 |
| **Response**  | `{ success: boolean }` |

### `POST /api/media/collection/:id/insert/:mediaKind/:mediaId`

Insert a media item into a collection.

|               | Type  |
| ------------- | ----- |
| **Query**     | None  |
| **Body**      | None  |
| **Response**  | `void` |

### `POST /api/media/collection/:id/remove/:mediaKind/:mediaId`

Remove a media item from a collection.

|               | Type  |
| ------------- | ----- |
| **Query**     | None  |
| **Body**      | None  |
| **Response**  | `void` |

### `DELETE /api/media/collection/:id/:kind`

Remove a kind from a collection and all its children (bottom-up).

|               | Type  |
| ------------- | ----- |
| **Query**     | None  |
| **Body**      | None  |
| **Response**  | `void` |

---

## CustomController

**Base path:** `/api/media/custom`

```ts
type CustomMediaRecord = PlayableMediaRecord & {
    kind: MediaKind.Custom;
    subtitle?: string;
    plot?: string;
};
```

### `GET /api/media/custom`

Lists custom media records with pagination, sorting, filtering, and search.

|               | Type                                                                                                                                                                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Query**     | `RequestQuery<CustomMediaRecord> & { filterWatched?: "include" \| "exclude"; filterRepositories?: Record<string, "include" \| "exclude">; filterGenres?: Record<string, "include" \| "exclude">; filterCollections?: Record<string, "include" \| "exclude">; transient?: "include" \| "exclude"; sample?: number; cast?: "true" }` |
| **Body**      | None                                                                                                                                                                                                                                                           |
| **Response**  | `CustomMediaRecord[]`                                                                                                                                                                                                                                          |

### `GET /api/media/custom/:id`

Retrieves a single custom media record by its ID.

|               | Type                                                                                                                                                                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Query**     | `RequestQuery<CustomMediaRecord> & { filterWatched?: "include" \| "exclude"; filterRepositories?: Record<string, "include" \| "exclude">; filterGenres?: Record<string, "include" \| "exclude">; filterCollections?: Record<string, "include" \| "exclude">; transient?: "include" \| "exclude"; sample?: number; cast?: "true" }` |
| **Body**      | None                                                                                                                                                                                                                                                           |
| **Response**  | `CustomMediaRecord`                                                                                                                                                                                                                                             |

### `POST /api/media/custom`

Creates a new custom media record.

|               | Type                 |
| ------------- | -------------------- |
| **Query**     | None                 |
| **Body**      | `CustomMediaRecord`  |
| **Response**  | `CustomMediaRecord`  |

### `POST /api/media/custom/:id`

Updates an existing custom media record by its ID.

|               | Type                            |
| ------------- | ------------------------------- |
| **Query**     | None                            |
| **Body**      | `Partial<CustomMediaRecord>`    |
| **Response**  | `CustomMediaRecord`             |

### `DELETE /api/media/custom/:id`

Deletes a custom media record by its ID.

|               | Type                 |
| ------------- | -------------------- |
| **Query**     | None                 |
| **Body**      | None                 |
| **Response**  | `{ success: boolean }` |

### `GET /api/media/custom/:id/artwork`

Retrieves all available artwork images for a custom media record.

|               | Type          |
| ------------- | ------------- |
| **Query**     | None          |
| **Body**      | None          |
| **Response**  | `ArtRecord[]` |

### `POST /api/media/custom/:id/artwork`

Sets a specific artwork property for the record.

|               | Type                                                         |
| ------------- | ------------------------------------------------------------ |
| **Query**     | None                                                         |
| **Body**      | `{ property: "poster" \| "background" \| "banner" \| "thumbnail"; artwork: string }` |
| **Response**  | `MediaRecord`                                                |

### `GET /api/media/custom/:id/triggers`

Retrieves trigger warnings associated with a custom media record.

|               | Type             |
| ------------- | ---------------- |
| **Query**     | None             |
| **Body**      | None             |
| **Response**  | `MediaTrigger[]` |

### `GET /api/media/custom/:id/streams`

Retrieves available streaming sources.

|               | Type                                     |
| ------------- | ---------------------------------------- |
| **Query**     | None                                     |
| **Body**      | None                                     |
| **Response**  | `Array<StreamInfo & { path: string }>`   |

### `GET /api/media/custom/:id/collections`

Retrieves the collections containing this record.

|               | Type                 |
| ------------- | -------------------- |
| **Query**     | None                 |
| **Body**      | None                 |
| **Response**  | `CollectionRecord[]` |

### `GET /api/media/custom/:id/cast`

Retrieves the cast (people) associated with the record.

|               | Type             |
| ------------- | ---------------- |
| **Query**     | None             |
| **Body**      | None             |
| **Response**  | `PersonRecord[]` |

### `GET /api/media/custom/:id/probe`

Retrieves the cached probe data.

|               | Type                |
| ------------- | ------------------- |
| **Query**     | None                |
| **Body**      | None                |
| **Response**  | `MediaProbeRecord`  |

### `POST /api/media/custom/:id/probe`

Probes the media for metadata with optional cache control.

|               | Type                                             |
| ------------- | ------------------------------------------------ |
| **Query**     | None                                             |
| **Body**      | `{ readCache?: boolean; writeCache?: boolean }`  |
| **Response**  | Probe result                                     |

### `GET /api/media/custom/:id/remux`

Gets the current remux job status.

|               | Type               |
| ------------- | ------------------ |
| **Query**     | None               |
| **Body**      | None               |
| **Response**  | `RemuxJob \| null` |

### `POST /api/media/custom/:id/remux`

Starts a remux job with specified stream selections.

|               | Type                                                                                                                                                                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Query**     | None                                                                                                                                                                                                                                                            |
| **Body**      | `{ streams: Array<{ index: number; type: "video" \| "audio" \| "subtitle"; language?: string; title?: string; original?: boolean; default?: boolean; forced?: boolean; hearingImpaired?: boolean }>; dryRun?: boolean }` |
| **Response**  | `RemuxJob`                                                                                                                                                                                                                                                      |

### `POST /api/media/custom/:id/watch/:status`

Sets the watched status (`:status` is `"true"` or `"false"`).

|               | Type                 |
| ------------- | -------------------- |
| **Query**     | None                 |
| **Body**      | None                 |
| **Response**  | `CustomMediaRecord`  |

### `GET /api/media/custom/qualities`

Retrieves distinct quality values from media metadata.

|               | Type                             |
| ------------- | -------------------------------- |
| **Query**     | `{ fields?: string[] }`          |
| **Body**      | None                             |
| **Response**  | `Partial<PlayableMediaQualities>` |

---

## MediaController (MediaTableController)

**Base path:** Varies by subclass (`/api/media/movie`, `/api/media/show`, etc.)

This is an abstract base controller. The following endpoints are inherited by all media controllers.

### `GET /:id/artwork`

Retrieves all available artwork images for a media item.

|               | Type          |
| ------------- | ------------- |
| **Query**     | None          |
| **Body**      | None          |
| **Response**  | `ArtRecord[]` |

### `POST /:id/artwork`

Sets a specific artwork property for a media item.

|               | Type                                                         |
| ------------- | ------------------------------------------------------------ |
| **Query**     | None                                                         |
| **Body**      | `{ property: "poster" \| "background" \| "banner" \| "thumbnail"; artwork: string }` |
| **Response**  | `MediaRecord`                                                |

### `GET /:id/triggers`

Returns all content triggers associated with a media item.

|               | Type             |
| ------------- | ---------------- |
| **Query**     | None             |
| **Body**      | None             |
| **Response**  | `MediaTrigger[]` |

### `GET /:id/streams`

Lists all available streams for a playable media item.

|               | Type                                     |
| ------------- | ---------------------------------------- |
| **Query**     | None                                     |
| **Body**      | None                                     |
| **Response**  | `Array<StreamInfo & { path: string }>`   |

### `GET /:id/collections`

Returns all collections containing the media item.

|               | Type                 |
| ------------- | -------------------- |
| **Query**     | None                 |
| **Body**      | None                 |
| **Response**  | `CollectionRecord[]` |

### `GET /:id/cast`

Returns the cast (people) associated with a media item.

|               | Type             |
| ------------- | ---------------- |
| **Query**     | None             |
| **Body**      | None             |
| **Response**  | `PersonRecord[]` |

### `GET /:id/probe`

Returns the cached probe metadata for a media item.

|               | Type                       |
| ------------- | -------------------------- |
| **Query**     | None                       |
| **Body**      | None                       |
| **Response**  | `MediaProbeRecord \| null` |

### `POST /:id/probe`

Probes a playable media item for its technical metadata.

|               | Type                                             |
| ------------- | ------------------------------------------------ |
| **Query**     | None                                             |
| **Body**      | `{ readCache?: boolean; writeCache?: boolean }`  |
| **Response**  | `MediaProbeRecord`                               |

### `GET /:id/remux`

Returns the current remux job status, or null.

|               | Type               |
| ------------- | ------------------ |
| **Query**     | None               |
| **Body**      | None               |
| **Response**  | `RemuxJob \| null` |

### `POST /:id/remux`

Starts a remux operation with the given stream selections.

|               | Type                                                                                                                                                                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Query**     | None                                                                                                                                                                                                                                                            |
| **Body**      | `{ streams: Array<{ index: number; type: "video" \| "audio" \| "subtitle"; language?: string; title?: string; original?: boolean; default?: boolean; forced?: boolean; hearingImpaired?: boolean }>; dryRun?: boolean }` |
| **Response**  | `RemuxJob`                                                                                                                                                                                                                                                      |

### `POST /:id/watch/:status`

Sets the watched status (`:status` is `"true"` or `"false"`).

|               | Type           |
| ------------- | -------------- |
| **Query**     | None           |
| **Body**      | None           |
| **Response**  | `MediaRecord`  |

### `GET /qualities`

Returns distinct quality values across all media in this table.

|               | Type                             |
| ------------- | -------------------------------- |
| **Query**     | `{ fields?: string[] }`          |
| **Body**      | None                             |
| **Response**  | `Partial<PlayableMediaQualities>` |

---

## MoviesController

**Base path:** `/api/media/movie`

### `GET /api/media/movie`

Lists movies with filtering, sorting, search, and pagination.

|               | Type                                                                                                                                                                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Query**     | `RequestQuery<MovieMediaRecord> & { filterWatched?: "include" \| "exclude"; filterRepositories?: Record<string, "include" \| "exclude">; filterGenres?: Record<string, "include" \| "exclude">; filterCollections?: Record<string, "include" \| "exclude">; filterResolutions?: Record<string, "include" \| "exclude">; filterVideoCodecs?: Record<string, "include" \| "exclude">; filterColorspaces?: Record<string, "include" \| "exclude">; filterBitdepths?: Record<string, "include" \| "exclude">; filterChannels?: Record<string, "include" \| "exclude">; filterAudioCodecs?: Record<string, "include" \| "exclude">; filterLanguages?: Record<string, "include" \| "exclude">; filterSources?: Record<string, "include" \| "exclude">; transient?: "include" \| "exclude"; sample?: number; collections?: "true"; cast?: "true" }` |
| **Body**      | None                                                                                                                                                                                                                                                           |
| **Response**  | `MovieMediaRecord[]`                                                                                                                                                                                                                                           |

### `GET /api/media/movie/:id`

Retrieves a single movie by its ID.

|               | Type              |
| ------------- | ----------------- |
| **Query**     | `any`             |
| **Body**      | None              |
| **Response**  | `MovieMediaRecord` |

### `POST /api/media/movie`

Creates a new movie record.

|               | Type                       |
| ------------- | -------------------------- |
| **Query**     | None                       |
| **Body**      | `Partial<MovieMediaRecord>` |
| **Response**  | `MovieMediaRecord`         |

### `POST /api/media/movie/:id`

Updates an existing movie record.

|               | Type                       |
| ------------- | -------------------------- |
| **Query**     | None                       |
| **Body**      | `Partial<MovieMediaRecord>` |
| **Response**  | `MovieMediaRecord`         |

### `DELETE /api/media/movie/:id`

Deletes a movie record by its ID.

|               | Type                 |
| ------------- | -------------------- |
| **Query**     | None                 |
| **Body**      | None                 |
| **Response**  | `{ success: boolean }` |

### `GET /api/media/movie/genres`

Returns a distinct list of all genres across all movies.

|               | Type       |
| ------------- | ---------- |
| **Query**     | None       |
| **Body**      | None       |
| **Response**  | `string[]` |

### `GET /api/media/movie/qualities`

Returns distinct quality values from movie metadata.

|               | Type                             |
| ------------- | -------------------------------- |
| **Query**     | `{ fields?: string[] }`          |
| **Body**      | None                             |
| **Response**  | `Partial<PlayableMediaQualities>` |

### `GET /api/media/movie/:id/artwork`

Lists all available artwork for a movie.

|               | Type          |
| ------------- | ------------- |
| **Query**     | None          |
| **Body**      | None          |
| **Response**  | `ArtRecord[]` |

### `POST /api/media/movie/:id/artwork`

Sets a specific artwork property for a movie.

|               | Type                                                         |
| ------------- | ------------------------------------------------------------ |
| **Query**     | None                                                         |
| **Body**      | `{ property: "poster" \| "background" \| "banner" \| "thumbnail"; artwork: string }` |
| **Response**  | `MovieMediaRecord`                                           |

### `GET /api/media/movie/:id/triggers`

Returns all trigger definitions for a movie.

|               | Type             |
| ------------- | ---------------- |
| **Query**     | None             |
| **Body**      | None             |
| **Response**  | `MediaTrigger[]` |

### `GET /api/media/movie/:id/streams`

Returns available streaming sources for a movie.

|               | Type                                     |
| ------------- | ---------------------------------------- |
| **Query**     | None                                     |
| **Body**      | None                                     |
| **Response**  | `Array<StreamInfo & { path: string }>`   |

### `GET /api/media/movie/:id/collections`

Returns all collections containing this movie.

|               | Type                 |
| ------------- | -------------------- |
| **Query**     | None                 |
| **Body**      | None                 |
| **Response**  | `CollectionRecord[]` |

### `GET /api/media/movie/:id/cast`

Returns the cast for a movie.

|               | Type             |
| ------------- | ---------------- |
| **Query**     | None             |
| **Body**      | None             |
| **Response**  | `PersonRecord[]` |

### `GET /api/media/movie/:id/probe`

Returns cached probe data for a movie.

|               | Type                |
| ------------- | ------------------- |
| **Query**     | None                |
| **Body**      | None                |
| **Response**  | `MediaProbeRecord`  |

### `POST /api/media/movie/:id/probe`

Probes a movie for its metadata.

|               | Type                                             |
| ------------- | ------------------------------------------------ |
| **Query**     | None                                             |
| **Body**      | `{ readCache?: boolean; writeCache?: boolean }`  |
| **Response**  | Probe result                                     |

### `GET /api/media/movie/:id/remux`

Returns the current remux job status for a movie.

|               | Type               |
| ------------- | ------------------ |
| **Query**     | None               |
| **Body**      | None               |
| **Response**  | `RemuxJob \| null` |

### `POST /api/media/movie/:id/remux`

Starts a remux job for a movie.

|               | Type                                                                                                                                                                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Query**     | None                                                                                                                                                                                                                                                            |
| **Body**      | `{ streams: Array<{ index: number; type: "video" \| "audio" \| "subtitle"; language?: string; title?: string; original?: boolean; default?: boolean; forced?: boolean; hearingImpaired?: boolean }>; dryRun?: boolean }` |
| **Response**  | `RemuxJob`                                                                                                                                                                                                                                                      |

### `POST /api/media/movie/:id/watch/:status`

Sets the watched status of a movie (`:status` is `"true"` or `"false"`).

|               | Type              |
| ------------- | ----------------- |
| **Query**     | None              |
| **Body**      | None              |
| **Response**  | `MovieMediaRecord` |

---

## PeopleController

**Base path:** `/api/media/people`

### `GET /api/media/people`

Lists people with pagination, sorting, and text search. Optionally loads credits.

|               | Type                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| **Query**     | `{ skip?: number; take?: number; search?: string; credits?: string; filterSort?: string \| { field: string; direction?: "asc" \| "desc"; list?: string } }` |
| **Body**      | None                                                                                                    |
| **Response**  | `PersonRecord[]`                                                                                        |

### `GET /api/media/people/:id`

Retrieves a single person by their ID.

|               | Type            |
| ------------- | --------------- |
| **Query**     | None            |
| **Body**      | None            |
| **Response**  | `PersonRecord`  |

### `POST /api/media/people`

Creates a new person record.

|               | Type            |
| ------------- | --------------- |
| **Query**     | None            |
| **Body**      | `PersonRecord`  |
| **Response**  | `PersonRecord`  |

### `POST /api/media/people/:id`

Updates an existing person record.

|               | Type                       |
| ------------- | -------------------------- |
| **Query**     | None                       |
| **Body**      | `Partial<PersonRecord>`    |
| **Response**  | `PersonRecord`             |

### `DELETE /api/media/people/:id`

Deletes a person record by its ID.

|               | Type                 |
| ------------- | -------------------- |
| **Query**     | None                 |
| **Body**      | None                 |
| **Response**  | `{ success: boolean }` |

---

## ProvidersController

**Base path:** `/api/media/providers`

### `GET|POST /api/media/providers/sync`

Triggers a media synchronization task that scrapes, updates, and repairs media records.

|               | Type                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Query**     | `{ kinds?: "movie" \| "show" \| "season" \| "episode" \| "custom"; cleanMissing?: boolean; dryRun?: boolean; refetchExisting?: boolean; refetchIncomplete?: boolean; updateMoved?: boolean; cache?: { read?: boolean; write?: boolean }; repairMode?: 0 \| 1 \| 2; localArtworkPreservation?: 0 \| 1 \| 2 \| 3; incomingArtworkAcceptance?: 0 \| 1 \| 2 \| 3; refreshRecords?: Array<{ kind: "movie" \| "show" \| "season" \| "episode" \| "custom"; id: string }> }` |
| **Body**      | None                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Response**  | `BackgroundTask`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### `GET /api/media/providers/sync/:id`

Retrieves a background synchronization task by its ID.

|               | Type             |
| ------------- | ---------------- |
| **Query**     | None             |
| **Body**      | None             |
| **Response**  | `BackgroundTask` |

### `GET|POST /api/media/providers/repair`

Runs a database repair operation that fixes inconsistencies.

|               | Type   |
| ------------- | ------ |
| **Query**     | None   |
| **Body**      | None   |
| **Response**  | `void` |

---

## RepositoriesController

**Base path:** `/api/media/repositories`

### `GET /api/media/repositories`

Lists media repositories, optionally filtered by kind. When `virtual=true`, returns virtual repositories.

|               | Type                                           |
| ------------- | ---------------------------------------------- |
| **Query**     | `{ kinds?: string; virtual?: string }`         |
| **Body**      | None                                           |
| **Response**  | `IMediaRepository[] \| IVirtualRepository[]`   |

---

## ScrapersController

**Base path:** `/api/media/scrapers`

```ts
type ExternalReferences = { imdb?: string; tvdb?: string; [key: string]: string };
interface IScraperQuery { year?: number; language?: string; boxSet?: string }
interface CacheOptions { readTtl?: number; readCache?: boolean; writeCache?: boolean; writeTtl?: number }
```

### `GET /api/media/scrapers/parse`

Parses one or more media file names into structured data.

|               | Type                            |
| ------------- | ------------------------------- |
| **Query**     | `{ name: string \| string[] }`  |
| **Body**      | None                            |
| **Response**  | `any` (parsed name result(s))   |

### `GET /api/media/scrapers/:scraper/:kind/external`

Fetches a media record by external reference identifiers from a specific scraper.

|               | Type                                                         |
| ------------- | ------------------------------------------------------------ |
| **Query**     | `{ external: ExternalReferences; query?: IScraperQuery; cache?: CacheOptions }` |
| **Body**      | None                                                         |
| **Response**  | `MediaRecord`                                                |

### `GET /api/media/scrapers/all/:kind/external/artwork`

Fetches artwork from all scrapers by external references.

|               | Type                                                         |
| ------------- | ------------------------------------------------------------ |
| **Query**     | `{ external: ExternalReferences; query?: IScraperQuery; cache?: CacheOptions }` |
| **Body**      | None                                                         |
| **Response**  | `ArtRecord[]`                                                |

### `GET /api/media/scrapers/:scraper/:kind/external/artwork`

Fetches artwork from a specific scraper by external references.

|               | Type                                                         |
| ------------- | ------------------------------------------------------------ |
| **Query**     | `{ external: ExternalReferences; query?: IScraperQuery; cache?: CacheOptions }` |
| **Body**      | None                                                         |
| **Response**  | `ArtRecord[]`                                                |

### `GET /api/media/scrapers/:scraper/:kind/external/:relation`

Fetches related media records by external reference from a specific scraper.

|               | Type                                                         |
| ------------- | ------------------------------------------------------------ |
| **Query**     | `{ external: ExternalReferences; query?: IScraperQuery; cache?: CacheOptions }` |
| **Body**      | None                                                         |
| **Response**  | `MediaRecord[]`                                              |

### `GET /api/media/scrapers/:scraper/:kind/internal/:id`

Fetches a media record by internal scraper ID.

|               | Type                                           |
| ------------- | ---------------------------------------------- |
| **Query**     | `{ query?: IScraperQuery; cache?: CacheOptions }` |
| **Body**      | None                                           |
| **Response**  | `MediaRecord`                                  |

### `GET /api/media/scrapers/:scraper/:kind/internal/:id/artwork`

Fetches artwork by internal scraper ID.

|               | Type                                           |
| ------------- | ---------------------------------------------- |
| **Query**     | `{ query?: IScraperQuery; cache?: CacheOptions }` |
| **Body**      | None                                           |
| **Response**  | `ArtRecord[]`                                  |

### `GET /api/media/scrapers/:scraper/:kind/internal/:id/:relation`

Fetches related media by internal scraper ID.

|               | Type                                           |
| ------------- | ---------------------------------------------- |
| **Query**     | `{ query?: IScraperQuery; cache?: CacheOptions }` |
| **Body**      | None                                           |
| **Response**  | `MediaRecord[]`                                |

### `GET /api/media/scrapers/:scraper/:kind/internal/:id/cast`

Fetches cast (role records) by internal scraper ID.

|               | Type                                           |
| ------------- | ---------------------------------------------- |
| **Query**     | `{ query?: IScraperQuery; cache?: CacheOptions }` |
| **Body**      | None                                           |
| **Response**  | `RoleRecord[]`                                 |

### `GET /api/media/scrapers/:scraper/:kind/search`

Searches for media using a text query via a specific scraper.

|               | Type                                                                        |
| ------------- | --------------------------------------------------------------------------- |
| **Query**     | `{ query: string; limit?: number; queryOpts?: IScraperQuery; cache?: CacheOptions }` |
| **Body**      | None                                                                        |
| **Response**  | `MediaRecord[]`                                                             |

---

## SessionsController

**Base path:** `/api/media/sessions`

```ts
interface HistoryRecord extends BaseRecord, TimestampedRecord {
    mediaId: string;
    mediaKind: MediaKind;
    mediaTitle: string;
    mediaSubTitle?: string;
    mediaSources?: any;
    playlistId?: string;
    playlistPosition?: number;
    receiver: string;
    position: number;
    positionHistory: { start: number; end: number }[];
    transcoding?: any;
    importedFrom?: string;
    watched: boolean;
}
```

### `GET /api/media/sessions`

List session history records with pagination, sorting, and filtering.
Supports filtering by media, date range, and embedding related media records.

|               | Type                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Query**     | `RequestQuery<HistoryRecord> & { filterMedia?: string[]; filterDateStart?: number; filterDateEnd?: number; records?: string }`                                                 |
| **Body**      | None                                                                                                                                                                           |
| **Response**  | `HistoryRecord[]` (with optional `.record: MediaRecord` when `records=true`)                                                                                                    |

### `GET /api/media/sessions/:id`

Retrieve a single session history record by its ID.

|               | Type             |
| ------------- | ---------------- |
| **Query**     | None             |
| **Body**      | None             |
| **Response**  | `HistoryRecord`  |

### `DELETE /api/media/sessions/:id`

Delete a session history record by its ID.

|               | Type                 |
| ------------- | -------------------- |
| **Query**     | None                 |
| **Body**      | None                 |
| **Response**  | `{ success: boolean }` |

---

## StorageController

**Base path:** `/api/storage`

```ts
interface StorageRecord<V = any> extends BaseRecord, TimestampedRecord {
    key: string;
    tags: string[];
    value: V;
}
```

### `GET /api/storage`

List storage records optionally filtered by a key prefix.

|               | Type                    |
| ------------- | ----------------------- |
| **Query**     | `{ prefix?: string }`   |
| **Body**      | None                    |
| **Response**  | `StorageRecord[]`       |

### `GET /api/storage/:key`

Retrieve a single storage record by its key.

|               | Type              |
| ------------- | ----------------- |
| **Query**     | None              |
| **Body**      | None              |
| **Response**  | `StorageRecord`   |

### `POST /api/storage/:key`

Store (create or replace) a value under the given key.

|               | Type              |
| ------------- | ----------------- |
| **Query**     | None              |
| **Body**      | `any`             |
| **Response**  | `StorageRecord`   |

### `DELETE /api/storage/:key`

Delete a storage record by its key.

|               | Type       |
| ------------- | ---------- |
| **Query**     | None       |
| **Body**      | None       |
| **Response**  | `boolean`  |

### `POST /api/storage/:key/add-to-set`

Add an object to a set identified by the key.

|               | Type                                              |
| ------------- | ------------------------------------------------- |
| **Query**     | None                                              |
| **Body**      | `{ object: object; primaryKeys?: string[] }`      |
| **Response**  | `{ changed: boolean }`                            |

### `POST /api/storage/:key/delete-from-set`

Remove an object from a set identified by the key.

|               | Type                                              |
| ------------- | ------------------------------------------------- |
| **Query**     | None                                              |
| **Body**      | `{ object: object; primaryKeys?: string[] }`      |
| **Response**  | `{ changed: boolean }`                            |

---

## SubtitlesController

**Base path:** `/api/media/subtitles`

```ts
interface ISubtitle {
    id: string; releaseName: string; encoding: string; format: string;
    language: string; publishedAt: Date; downloads: number; provider: string; score: number;
}
interface ILocalSubtitle { id?: string; releaseName: string; language: string; format: string }
interface IGroupedLocalSubtitle { media: PlayableMediaRecord; subtitles: ILocalSubtitle[] }
interface ManagerSearchOptions { langs?: string[]; seasonOffset?: number; episodeOffset?: number; providersNames?: string[] }
```

### `GET /api/media/subtitles/:kind/:id/local`

Lists local subtitles for a media item. Supports grouping by playable media.

|               | Type                                             |
| ------------- | ------------------------------------------------ |
| **Query**     | `{ grouped?: string; langs?: string \| string[] }` |
| **Body**      | None                                             |
| **Response**  | `IGroupedLocalSubtitle[] \| ILocalSubtitle[]`    |

### `GET /api/media/subtitles/:kind/:id/remote`

Searches for remote subtitles from configured providers.

|               | Type                                                                          |
| ------------- | ----------------------------------------------------------------------------- |
| **Query**     | `{ langs?: string \| string[]; episodeOffset?: number; seasonOffset?: number }` |
| **Body**      | None                                                                          |
| **Response**  | `ISubtitle[]`                                                                 |

### `POST /api/media/subtitles/:kind/:id/local/:sub/rename`

Renames a local subtitle's release name.

|               | Type                      |
| ------------- | ------------------------- |
| **Query**     | None                      |
| **Body**      | `{ releaseName: string }` |
| **Response**  | `ILocalSubtitle`          |

### `GET /api/media/subtitles/:kind/:id/local/:sub/synchronize/:command`

Generates a synchronization URI for a local subtitle.

|               | Type             |
| ------------- | ---------------- |
| **Query**     | None             |
| **Body**      | None             |
| **Response**  | `{ uri: string }` |

### `GET /api/media/subtitles/:kind/:id/remote/:sub/synchronize/:command`

Generates a synchronization URI for a remote subtitle.

|               | Type                                                                          |
| ------------- | ----------------------------------------------------------------------------- |
| **Query**     | `{ langs?: string \| string[]; episodeOffset?: number; seasonOffset?: number }` |
| **Body**      | None                                                                          |
| **Response**  | `{ uri: string }`                                                             |

### `GET /api/media/subtitles/:kind/:id/local/:sub/validate`

Launches MPV to validate a local subtitle's synchronization. *Deprecated.*

|               | Type  |
| ------------- | ----- |
| **Query**     | None  |
| **Body**      | None  |
| **Response**  | `void` |

### `GET /api/media/subtitles/:kind/:id/remote/:sub/validate`

Launches MPV to validate a remote subtitle's synchronization. *Deprecated.*

|               | Type                                                                          |
| ------------- | ----------------------------------------------------------------------------- |
| **Query**     | `{ langs?: string \| string[]; episodeOffset?: number; seasonOffset?: number }` |
| **Body**      | None                                                                          |
| **Response**  | `void`                                                                        |

### `POST /api/media/subtitles/:kind/:id`

Saves (downloads and stores) subtitles for a media item.

|               | Type                                              |
| ------------- | ------------------------------------------------- |
| **Query**     | `{ grouped?: boolean \| string }`                 |
| **Body**      | `{ subtitles: ISubtitle[]; grouped?: boolean \| string }` |
| **Response**  | `IGroupedLocalSubtitle[] \| ILocalSubtitle[]`    |

### `GET /api/media/subtitles/:kind/:id/local/:sub`

Downloads a local subtitle file as binary content.

|               | Type               |
| ------------- | ------------------ |
| **Query**     | None               |
| **Body**      | None               |
| **Response**  | `FileInfo` (binary) |

### `PUT /api/media/subtitles/:kind/:id/local/:sub`

Uploads/updates a local subtitle file in-place.

|               | Type                      |
| ------------- | ------------------------- |
| **Query**     | None                      |
| **Body**      | Raw stream (subtitle file) |
| **Response**  | `void`                    |

### `GET /api/media/subtitles/:kind/:id/remote/:sub`

Downloads a remote subtitle file as binary content.

|               | Type                                                                          |
| ------------- | ----------------------------------------------------------------------------- |
| **Query**     | `{ langs?: string \| string[]; episodeOffset?: number; seasonOffset?: number }` |
| **Body**      | None                                                                          |
| **Response**  | `FileInfo` (binary)                                                           |

### `PUT /api/media/subtitles/:kind/:id/remote/:sub`

Stores a remote subtitle locally. Responds with 303 redirect to the new local subtitle URL.

|               | Type                                                                          |
| ------------- | ----------------------------------------------------------------------------- |
| **Query**     | `{ langs?: string \| string[]; episodeOffset?: number; seasonOffset?: number }` |
| **Body**      | Raw stream (subtitle file)                                                     |
| **Response**  | `void` (303 redirect)                                                          |

### `DELETE /api/media/subtitles/:kind/:id/local/:sub`

Deletes a local subtitle. Returns the remaining local subtitles.

|               | Type              |
| ------------- | ----------------- |
| **Query**     | None              |
| **Body**      | None              |
| **Response**  | `ILocalSubtitle[]` |

---

## TvEpisodesController

**Base path:** `/api/media/episode`

```ts
type TvEpisodeMediaRecord = PlayableMediaRecord & {
    kind: MediaKind.TvEpisode;
    number: number;
    seasonNumber: number;
    tvSeasonId: string;
    tvSeasonKind: string;
    rating: number;
    plot: string;
    airedAt: Date;
};
```

### `GET /api/media/episode`

Lists TV episodes with pagination, sorting, filtering by season/show, watched, repositories, and metadata.

|               | Type                                                                                                                                                                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Query**     | `RequestQuery<TvEpisodeMediaRecord> & { show?: string; seasonNumber?: number; filterWatched?: "include" \| "exclude"; filterRepositories?: Record<string, "include" \| "exclude">; filterResolutions?: Record<string, "include" \| "exclude">; filterVideoCodecs?: Record<string, "include" \| "exclude">; filterColorspaces?: Record<string, "include" \| "exclude">; filterBitdepths?: Record<string, "include" \| "exclude">; filterChannels?: Record<string, "include" \| "exclude">; filterAudioCodecs?: Record<string, "include" \| "exclude">; filterLanguages?: Record<string, "include" \| "exclude">; filterSources?: Record<string, "include" \| "exclude">; transient?: "include" \| "exclude"; cast?: "true" }` |
| **Body**      | None                                                                                                                                                                                                                                                           |
| **Response**  | `TvEpisodeMediaRecord[]`                                                                                                                                                                                                                                       |

### `GET /api/media/episode/:id`

Retrieves a single TV episode by its ID.

|               | Type                    |
| ------------- | ----------------------- |
| **Query**     | None                    |
| **Body**      | None                    |
| **Response**  | `TvEpisodeMediaRecord`  |

### `POST /api/media/episode`

Creates a new TV episode record.

|               | Type                    |
| ------------- | ----------------------- |
| **Query**     | None                    |
| **Body**      | `TvEpisodeMediaRecord`  |
| **Response**  | `TvEpisodeMediaRecord`  |

### `POST /api/media/episode/:id`

Updates an existing TV episode record.

|               | Type                             |
| ------------- | -------------------------------- |
| **Query**     | None                             |
| **Body**      | `Partial<TvEpisodeMediaRecord>`  |
| **Response**  | `TvEpisodeMediaRecord`           |

### `DELETE /api/media/episode/:id`

Deletes a TV episode record by its ID.

|               | Type                 |
| ------------- | -------------------- |
| **Query**     | None                 |
| **Body**      | None                 |
| **Response**  | `{ success: boolean }` |

### `GET /api/media/episode/:id/artwork`

Lists available artwork for a TV episode.

|               | Type          |
| ------------- | ------------- |
| **Query**     | None          |
| **Body**      | None          |
| **Response**  | `ArtRecord[]` |

### `POST /api/media/episode/:id/artwork`

Sets a specific artwork property for a TV episode.

|               | Type                                                         |
| ------------- | ------------------------------------------------------------ |
| **Query**     | None                                                         |
| **Body**      | `{ property: string; artwork: string }`                      |
| **Response**  | `TvEpisodeMediaRecord`                                       |

### `GET /api/media/episode/:id/triggers`

Retrieves content triggers for a TV episode.

|               | Type             |
| ------------- | ---------------- |
| **Query**     | None             |
| **Body**      | None             |
| **Response**  | `MediaTrigger[]` |

### `GET /api/media/episode/:id/streams`

Retrieves available streams for a playable TV episode.

|               | Type                                     |
| ------------- | ---------------------------------------- |
| **Query**     | None                                     |
| **Body**      | None                                     |
| **Response**  | `Array<StreamInfo & { path: string }>`   |

### `GET /api/media/episode/:id/collections`

Retrieves collections containing this TV episode.

|               | Type                 |
| ------------- | -------------------- |
| **Query**     | None                 |
| **Body**      | None                 |
| **Response**  | `CollectionRecord[]` |

### `GET /api/media/episode/:id/cast`

Retrieves the cast for a TV episode.

|               | Type             |
| ------------- | ---------------- |
| **Query**     | None             |
| **Body**      | None             |
| **Response**  | `PersonRecord[]` |

### `GET /api/media/episode/:id/probe`

Retrieves cached probe data for a TV episode.

|               | Type                |
| ------------- | ------------------- |
| **Query**     | None                |
| **Body**      | None                |
| **Response**  | `MediaProbeRecord`  |

### `POST /api/media/episode/:id/probe`

Probes a TV episode for metadata with optional cache control.

|               | Type                                             |
| ------------- | ------------------------------------------------ |
| **Query**     | None                                             |
| **Body**      | `{ readCache?: boolean; writeCache?: boolean }`  |
| **Response**  | Probe result                                     |

### `GET /api/media/episode/:id/remux`

Gets the current remux job status for a TV episode.

|               | Type               |
| ------------- | ------------------ |
| **Query**     | None               |
| **Body**      | None               |
| **Response**  | `RemuxJob \| null` |

### `POST /api/media/episode/:id/remux`

Starts a remux job for a TV episode.

|               | Type                                                                                                                                                                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Query**     | None                                                                                                                                                                                                                                                            |
| **Body**      | `{ streams: Array<{ index: number; type: "video" \| "audio" \| "subtitle"; language?: string; title?: string; original?: boolean; default?: boolean; forced?: boolean; hearingImpaired?: boolean }>; dryRun?: boolean }` |
| **Response**  | `RemuxJob`                                                                                                                                                                                                                                                      |

### `POST /api/media/episode/:id/watch/:status`

Sets the watched status (`:status` is `"true"` or `"false"`).

|               | Type                    |
| ------------- | ----------------------- |
| **Query**     | None                    |
| **Body**      | None                    |
| **Response**  | `TvEpisodeMediaRecord`  |

### `GET /api/media/episode/qualities`

Retrieves distinct quality values across all TV episodes.

|               | Type                             |
| ------------- | -------------------------------- |
| **Query**     | `{ fields?: string[] }`          |
| **Body**      | None                             |
| **Response**  | `Partial<PlayableMediaQualities>` |

---

## TvSeasonsController

**Base path:** `/api/media/season`

```ts
type TvSeasonMediaRecord = MediaRecord & {
    number: number;
    tvShowId: string;
    tvShowKind: string;
    episodesCount: number;
    watchedEpisodesCount: number;
};
```

### `GET /api/media/season`

Lists TV seasons with pagination, sorting, and filtering. Can embed episodes and cast.

|               | Type                                                                                                                                                                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Query**     | `RequestQuery<TvSeasonMediaRecord> & { show?: string; transient?: "include" \| "exclude"; episodes?: "true"; cast?: "true"; filterWatched?: "include" \| "exclude"; filterRepositories?: Record<string, "include" \| "exclude">; filterGenres?: Record<string, "include" \| "exclude">; filterCollections?: Record<string, "include" \| "exclude">; filterResolutions?: Record<string, "include" \| "exclude">; filterVideoCodecs?: Record<string, "include" \| "exclude">; filterColorspaces?: Record<string, "include" \| "exclude">; filterBitdepths?: Record<string, "include" \| "exclude">; filterChannels?: Record<string, "include" \| "exclude">; filterAudioCodecs?: Record<string, "include" \| "exclude">; filterLanguages?: Record<string, "include" \| "exclude">; filterSources?: Record<string, "include" \| "exclude"> }` |
| **Body**      | None                                                                                                                                                                                                                                                           |
| **Response**  | `TvSeasonMediaRecord[]`                                                                                                                                                                                                                                        |

### `GET /api/media/season/:id`

Retrieves a single TV season by its ID. Can embed episodes and cast.

|               | Type                                   |
| ------------- | -------------------------------------- |
| **Query**     | `{ episodes?: "true"; cast?: "true" }` |
| **Body**      | None                                   |
| **Response**  | `TvSeasonMediaRecord`                  |

### `POST /api/media/season`

Creates a new TV season record.

|               | Type                   |
| ------------- | ---------------------- |
| **Query**     | None                   |
| **Body**      | `TvSeasonMediaRecord`  |
| **Response**  | `TvSeasonMediaRecord`  |

### `POST /api/media/season/:id`

Updates an existing TV season record.

|               | Type                            |
| ------------- | ------------------------------- |
| **Query**     | None                            |
| **Body**      | `Partial<TvSeasonMediaRecord>`  |
| **Response**  | `TvSeasonMediaRecord`           |

### `DELETE /api/media/season/:id`

Deletes a TV season record by its ID.

|               | Type                 |
| ------------- | -------------------- |
| **Query**     | None                 |
| **Body**      | None                 |
| **Response**  | `{ success: boolean }` |

### `GET /api/media/season/:id/artwork`

Retrieves all available artwork for a TV season.

|               | Type          |
| ------------- | ------------- |
| **Query**     | None          |
| **Body**      | None          |
| **Response**  | `ArtRecord[]` |

### `POST /api/media/season/:id/artwork`

Sets a specific artwork property for a TV season.

|               | Type                                                         |
| ------------- | ------------------------------------------------------------ |
| **Query**     | None                                                         |
| **Body**      | `{ property: string; artwork: string }`                      |
| **Response**  | `MediaRecord`                                                |

### `GET /api/media/season/:id/triggers`

Retrieves all trigger entries for a TV season.

|               | Type             |
| ------------- | ---------------- |
| **Query**     | None             |
| **Body**      | None             |
| **Response**  | `MediaTrigger[]` |

### `GET /api/media/season/:id/streams`

Retrieves available streams for a playable TV season.

|               | Type                                     |
| ------------- | ---------------------------------------- |
| **Query**     | None                                     |
| **Body**      | None                                     |
| **Response**  | `Array<StreamInfo & { path: string }>`   |

### `GET /api/media/season/:id/collections`

Retrieves all collections containing this TV season.

|               | Type                 |
| ------------- | -------------------- |
| **Query**     | None                 |
| **Body**      | None                 |
| **Response**  | `CollectionRecord[]` |

### `GET /api/media/season/:id/cast`

Retrieves the cast for a TV season.

|               | Type             |
| ------------- | ---------------- |
| **Query**     | None             |
| **Body**      | None             |
| **Response**  | `PersonRecord[]` |

### `GET /api/media/season/:id/probe`

Retrieves cached probe data for a TV season.

|               | Type                       |
| ------------- | -------------------------- |
| **Query**     | None                       |
| **Body**      | None                       |
| **Response**  | `MediaProbeRecord \| null` |

### `POST /api/media/season/:id/probe`

Probes a TV season for metadata with optional cache control.

|               | Type                                             |
| ------------- | ------------------------------------------------ |
| **Query**     | None                                             |
| **Body**      | `{ readCache?: boolean; writeCache?: boolean }`  |
| **Response**  | Probe result                                     |

### `GET /api/media/season/:id/remux`

Gets the current remux job status for a TV season.

|               | Type               |
| ------------- | ------------------ |
| **Query**     | None               |
| **Body**      | None               |
| **Response**  | `RemuxJob \| null` |

### `POST /api/media/season/:id/remux`

Starts a remux job for a TV season.

|               | Type                                                                                                                                                                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Query**     | None                                                                                                                                                                                                                                                            |
| **Body**      | `{ streams: Array<{ index: number; type: "video" \| "audio" \| "subtitle"; language?: string; title?: string; original?: boolean; default?: boolean; forced?: boolean; hearingImpaired?: boolean }>; dryRun?: boolean }` |
| **Response**  | `RemuxJob`                                                                                                                                                                                                                                                      |

### `POST /api/media/season/:id/watch/:status`

Sets the watched status (`:status` is `"true"` or `"false"`).

|               | Type                   |
| ------------- | ---------------------- |
| **Query**     | None                   |
| **Body**      | None                   |
| **Response**  | `TvSeasonMediaRecord`  |

### `GET /api/media/season/qualities`

Retrieves distinct quality values across all TV seasons.

|               | Type                             |
| ------------- | -------------------------------- |
| **Query**     | `{ fields?: string[] }`          |
| **Body**      | None                             |
| **Response**  | `Partial<PlayableMediaQualities>` |

### `GET /api/media/season/:id/subtitles`

Retrieves subtitles for all episodes in a TV season. Returns a map keyed by episode number.

|               | Type                    |
| ------------- | ----------------------- |
| **Query**     | None                    |
| **Body**      | None                    |
| **Response**  | `Record<number, any>`   |

---

## TvShowsController

**Base path:** `/api/media/show`

```ts
type TvShowMediaRecord = MediaRecord & {
    kind: MediaKind.TvShow;
    // additional show-specific fields
};
```

### `GET /api/media/show`

Lists TV shows with sorting, filtering, search, and pagination. Can embed seasons, collections, and cast.

|               | Type                                                                                                                                                                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Query**     | `RequestQuery<TvShowMediaRecord> & { filterWatched?: "include" \| "exclude"; filterRepositories?: Record<string, "include" \| "exclude">; filterGenres?: Record<string, "include" \| "exclude">; filterCollections?: Record<string, "include" \| "exclude">; filterResolutions?: Record<string, "include" \| "exclude">; filterVideoCodecs?: Record<string, "include" \| "exclude">; filterColorspaces?: Record<string, "include" \| "exclude">; filterBitdepths?: Record<string, "include" \| "exclude">; filterChannels?: Record<string, "include" \| "exclude">; filterAudioCodecs?: Record<string, "include" \| "exclude">; filterLanguages?: Record<string, "include" \| "exclude">; filterSources?: Record<string, "include" \| "exclude">; transient?: "include" \| "exclude"; sample?: number; seasons?: "true"; collections?: "true"; cast?: "true" }` |
| **Body**      | None                                                                                                                                                                                                                                                           |
| **Response**  | `TvShowMediaRecord[]`                                                                                                                                                                                                                                          |

### `GET /api/media/show/:id`

Retrieves a single TV show by its ID. Can embed seasons, collections, and cast.

|               | Type                                                             |
| ------------- | ---------------------------------------------------------------- |
| **Query**     | `{ seasons?: "true"; collections?: "true"; cast?: "true" }`      |
| **Body**      | None                                                             |
| **Response**  | `TvShowMediaRecord`                                              |

### `POST /api/media/show`

Creates a new TV show record.

|               | Type                 |
| ------------- | -------------------- |
| **Query**     | None                 |
| **Body**      | `TvShowMediaRecord`  |
| **Response**  | `TvShowMediaRecord`  |

### `POST /api/media/show/:id`

Updates an existing TV show record.

|               | Type                            |
| ------------- | ------------------------------- |
| **Query**     | None                            |
| **Body**      | `Partial<TvShowMediaRecord>`    |
| **Response**  | `TvShowMediaRecord`             |

### `DELETE /api/media/show/:id`

Deletes a TV show record by its ID.

|               | Type                 |
| ------------- | -------------------- |
| **Query**     | None                 |
| **Body**      | None                 |
| **Response**  | `{ success: boolean }` |

### `GET /api/media/show/genres`

Returns a distinct list of all genres across TV shows.

|               | Type       |
| ------------- | ---------- |
| **Query**     | None       |
| **Body**      | None       |
| **Response**  | `string[]` |

### `GET /api/media/show/qualities`

Returns distinct quality values across TV show episodes.

|               | Type                             |
| ------------- | -------------------------------- |
| **Query**     | `{ fields?: string[] }`          |
| **Body**      | None                             |
| **Response**  | `Partial<PlayableMediaQualities>` |

### `GET /api/media/show/:id/artwork`

Lists all available artwork for a TV show.

|               | Type          |
| ------------- | ------------- |
| **Query**     | None          |
| **Body**      | None          |
| **Response**  | `ArtRecord[]` |

### `POST /api/media/show/:id/artwork`

Sets a specific artwork property for a TV show.

|               | Type                                                         |
| ------------- | ------------------------------------------------------------ |
| **Query**     | None                                                         |
| **Body**      | `{ property: "poster" \| "background" \| "banner" \| "thumbnail"; artwork: string }` |
| **Response**  | `MediaRecord`                                                |

### `GET /api/media/show/:id/triggers`

Returns all triggers associated with a TV show.

|               | Type             |
| ------------- | ---------------- |
| **Query**     | None             |
| **Body**      | None             |
| **Response**  | `MediaTrigger[]` |

### `GET /api/media/show/:id/streams`

Returns available streams for a playable TV show.

|               | Type                                     |
| ------------- | ---------------------------------------- |
| **Query**     | None                                     |
| **Body**      | None                                     |
| **Response**  | `Array<StreamInfo & { path: string }>`   |

### `GET /api/media/show/:id/collections`

Returns all collections containing this TV show.

|               | Type                 |
| ------------- | -------------------- |
| **Query**     | None                 |
| **Body**      | None                 |
| **Response**  | `CollectionRecord[]` |

### `GET /api/media/show/:id/cast`

Returns the cast for a TV show.

|               | Type             |
| ------------- | ---------------- |
| **Query**     | None             |
| **Body**      | None             |
| **Response**  | `PersonRecord[]` |

### `GET /api/media/show/:id/probe`

Returns cached probe data for a TV show.

|               | Type                |
| ------------- | ------------------- |
| **Query**     | None                |
| **Body**      | None                |
| **Response**  | `MediaProbeRecord`  |

### `POST /api/media/show/:id/probe`

Probes a TV show for metadata with optional cache control.

|               | Type                                             |
| ------------- | ------------------------------------------------ |
| **Query**     | None                                             |
| **Body**      | `{ readCache?: boolean; writeCache?: boolean }`  |
| **Response**  | Probe result                                     |

### `GET /api/media/show/:id/remux`

Returns the current remux job status for a TV show.

|               | Type               |
| ------------- | ------------------ |
| **Query**     | None               |
| **Body**      | None               |
| **Response**  | `RemuxJob \| null` |

### `POST /api/media/show/:id/remux`

Starts a remux job for a TV show.

|               | Type                                                                                                                                                                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Query**     | None                                                                                                                                                                                                                                                            |
| **Body**      | `{ streams: Array<{ index: number; type: "video" \| "audio" \| "subtitle"; language?: string; title?: string; original?: boolean; default?: boolean; forced?: boolean; hearingImpaired?: boolean }>; dryRun?: boolean }` |
| **Response**  | `RemuxJob`                                                                                                                                                                                                                                                      |

### `POST /api/media/show/:id/watch/:status`

Sets the watched status (`:status` is `"true"` or `"false"`).

|               | Type                 |
| ------------- | -------------------- |
| **Query**     | None                 |
| **Body**      | None                 |
| **Response**  | `TvShowMediaRecord`  |

# unicast - The universal media server
> **Warning** This project is still in alpha state and heavy development, with many features still to be added and bugs to be fixed

## Installation
> **Note** This installation process is temporary, and need some knowledge of how to work with the command line and is intended for advanced users. In the near future, a more simplified version will be created.

Download this repository, either by running the command
```bash
git clone git@github.com:scorchpt/unicast.git unicast
```

After that, install the NodeJs dependencies with the command
```bash
npm install --save-dev
```

Finally, download [RethinkDB](https://www.rethinkdb.com/) and save the executable somewhere on your disk. 
> **Tip** You may want to put it inside the `storage/` folder inside the unicast directory.

After that, the sources need to be compiled to JavaScript. Run the command
```bash
tsc
```

## Configuration
Create a file `config/local.yaml`, and configure the receivers and providers for your application. Right now, the only **receivers** that are implemented are Chromecast and the only **providers** that are implemented are Kodi.

For example, the file can be
```yaml
# Change primary language
primaryLanguage: por

# Change secondary languages
secondaryLanguages:
    - pob
    - eng

receivers:
    scan: false
    default: false
    list:
        - name: ChromecastName
          address: 192.168.0.60
          type: chromecast

providers:
    - name: kodi
      type: kodi
      address: 127.0.0.1
      port: 8008

ffmpeg:
    # Optional: If ffmpeg is not in PATH ENV, set a custom path
    path: C:\Program Files\ffmpeg\bin
```

## Usage
First start the database server. Go to the folder where `rethink.exe` is saved and run it.
```bash
rethink.exe
```

Leave the program running, and launch the media server
```bash
node lib/index.js
```
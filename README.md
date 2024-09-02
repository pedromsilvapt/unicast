# WARNING
Unicast is in the process of migrating the database from rethinkdb. The latest version of code using rethinkdb only, is being kept in the branch `archive/rethinkdb`.

This branch currently still has the dependencies and most of the code to interface with both RethinkDB and SQLite, but SQLite is the DB used by default. The goal of this version of the code is to be used only during migration.

If you are using this application and are facing issues with it, feel free to open a ticket, to make sure no data is lost during the migration.

# unicast - The universal media server
> **Warning** This project is still in alpha state and under heavy development, with many features still to be added and plenty of bugs to be fixed.

> **Note** The web interface development repository can be found [here](https://gitlab.com/unicast/unicast-interface).

[![Screenshot](http://pedromsilvapt.github.io/unicast/images/screenshots/alpha/shows-list.png)](http://pedromsilvapt.github.io/unicast/screenshots.html#lg=1&slide=2)

See [all screenshots](http://pedromsilvapt.github.io/unicast/screenshots.html).

## Installation
> **Note** This installation process is temporary, and some knowledge of how to work with the command line is needed, and as such it is intended for advanced users only. In the near future, a more simplified version will be created.

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

After that, the sources need to be compiled to JavaScript (Really? Sadly, really.). Run the command
```bash
tsc
```

If the command is not found, try installing Trypescript:
```bash
npm install -g typescript
```

And run `tsc` again.

## Configuration
Create a file `config/local.yaml`, and configure the receivers and providers for your application. Right now, the only **receivers** that are implemented are the Chromecast receiver and the only **providers** that are implemented are the Kodi provider.

 > **Note** As of now, the server should be able to auto detect the Chromecast devices in your network, so you only need to explicitly add them to the config file if, for some reason, they are not showing up automatically.

For example, the file can be:
```yaml
# Change primary language
primaryLanguage: por

# Change secondary languages
secondaryLanguages:
    - pob
    - eng

receivers:
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

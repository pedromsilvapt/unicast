VERSION 0.8
FROM node:24-alpine

WORKDIR /app/unicast

install-interface:
    ARG ALPINE
    ARG DEV
    # Git tag of unicast-interface to build against (e.g. v3.2.0); empty uses the default branch
    ARG INTERFACE_TAG=''

    IF [ "$ALPINE" == 1 ]
        FROM node:24-alpine
    ELSE
        FROM node:24
    END

    IF [ "$DEV" == 1 ]
        # Use the Earthfile from a unicast-interface/ folder  that is side-by-side with the unicast/ folder
        COPY ../unicast-interface+pack/*.tgz .
    ELSE IF [ -n "$INTERFACE_TAG" ]
        # Use the Earthfile from the unicast-interface git repository, pinned to a tag
        COPY gitlab.com/unicast/unicast-interface:$INTERFACE_TAG+pack/*.tgz .
    ELSE
        # Use the Earthfile from the unicast-interface git repository
        GIT CLONE git@gitlab.com:unicast/unicast-interface.git /unicast-interface
        WORKDIR /app/unicast-interface

        IMPORT gitlab.com/unicast/unicast-interface AS interface
        COPY interface+pack/*.tgz .
    END

    SAVE ARTIFACT ./*.tgz unicast-interface.tgz

install:
    ARG ALPINE
    ARG INTERFACE_TAG=''
    IF [ "$ALPINE" == 1 ]
        FROM node:24-alpine
        RUN apk add g++ make py3-pip
    ELSE
        FROM node:24
    END

    COPY --if-exists package.json package-lock.json ./
    RUN npm install --legacy-peer-deps
    COPY (+install-interface/unicast-interface.tgz --INTERFACE_TAG=$INTERFACE_TAG) .
    RUN npm install unicast-interface.tgz

    # HACK ALERT
    # Make a small modification to one of the files inside parse-torrent-name
    # Transformed the first line into the second:
    # year: /([\[\(]?((?:19[0-9]|20[01])[0-9])[\]\)]?)/,
    # year: /([\[\(]?((?:19[0-9]|20[0123])[0-9])[\]\)]?)/,
    RUN sed -i -e 's/01/0123/' ./node_modules/parse-torrent-name/parts/common.js

    SAVE ARTIFACT node_modules /node_modules AS LOCAL node_modules
    SAVE ARTIFACT package-lock.json /package-lock.json AS LOCAL package-lock.json

build:
    ARG INTERFACE_TAG=''
    FROM +install --INTERFACE_TAG=$INTERFACE_TAG

    RUN npm install -g typescript@5.8.2

    COPY tsconfig.json ./
    COPY src src
    RUN npx tsc

    SAVE ARTIFACT lib /lib AS LOCAL lib

artifacts:
    ARG INTERFACE_TAG=''

    COPY (+install/node_modules --INTERFACE_TAG=$INTERFACE_TAG) server/node_modules
    COPY (+install/package-lock.json --INTERFACE_TAG=$INTERFACE_TAG) server/package-lock.json
    COPY (+build/lib --INTERFACE_TAG=$INTERFACE_TAG) server/lib
    COPY config/default*.yaml server/config/
    COPY knexfile.js server/
    COPY package.json server/

    SAVE ARTIFACT . publish

docker:
    WORKDIR /app

    ARG REGISTRY='gitea.home'
    ARG IMAGE='silvas/unicast'
    ARG TAG='dev'
    # Set to 0 when pushing to a TLS registry such as Docker Hub
    ARG INSECURE='1'
    # Git tag of unicast-interface to build against (e.g. v3.2.0); empty uses the default branch
    ARG INTERFACE_TAG=''

    # Install runtime dependencies on the image
    RUN apk add ffmpeg micro

    # Copy before setting the workdir to the application
    COPY (+artifacts/publish --ALPINE 1 --INTERFACE_TAG=$INTERFACE_TAG) bin

    # Replace the default.yaml file with default-docker.yaml
    RUN mv bin/server/config/default-docker.yaml bin/server/config/default.yaml

    # TODO User & Permissions

    # Create the optional volume folders
    RUN mkdir -p configs data logs

    # The application comes with default configuration files stored in /app/bin/server/config/*.yaml
    # These can be overriden by the Host system when mounting them into the /app/configs folder
    ENV UNICAST_CONFIG_FOLDER=/app/configs

    # Prepare the Docker Image
    WORKDIR /app/bin/server
    CMD ["node", "./lib/index.js"]
    EXPOSE 8080

    HEALTHCHECK CMD ["curl", "-f", "http://localhost:8080/ping"] || exit 1

    SAVE IMAGE $IMAGE:$TAG
    IF [ "$INSECURE" == 1 ]
        SAVE IMAGE --push --insecure $REGISTRY/$IMAGE:$TAG
    ELSE
        SAVE IMAGE --push $REGISTRY/$IMAGE:$TAG
    END

docker-all:
    BUILD --platform=linux/amd64 \
          --platform=linux/arm64 \
          +docker

serve:
    WAIT
        BUILD +docker
    END

    LOCALLY
    RUN docker run --rm \
        --name unicast-dev \
        -v ./storage:/app/data \
        -v ./config/local.yaml:/app/configs/local.yaml:ro \
        -v /storage:/storage \
        -e ACTUAL_URL=https://actual.pedro.home/ \
        -p 3031:8080 \
        gitea.home/silvas/unicast:dev

all:
    BUILD +build
    BUILD +docker

VERSION 0.8
FROM node:14.17.3-alpine

WORKDIR /app/unicast

install-interface:
    ARG ALPINE
    ARG DEV

    IF [ "$ALPINE" == 1 ]
        FROM node:14.17.3-alpine
    ELSE
        FROM node:14.17.3
    END

    IF [ "$DEV" == 1 ]
        # Use the Earthfile from a unicast-interface/ folder  that is side-by-side with the unicast/ folder
        COPY ../unicast-interface+pack/*.tgz .
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
    IF [ "$ALPINE" == 1 ]
        FROM node:14.17.3-alpine
        RUN apk add g++ make py3-pip
    ELSE
        FROM node:14.17.3
    END

    COPY --if-exists package.json package-lock.json ./
    RUN npm install
    COPY +install-interface/unicast-interface.tgz .
    RUN npm install unicast-interface.tgz

    SAVE ARTIFACT node_modules /node_modules AS LOCAL node_modules
    SAVE ARTIFACT package-lock.json /package-lock.json AS LOCAL package-lock.json

build:
    FROM +install

    RUN npm install -g typescript@5.8.2

    COPY tsconfig.json ./
    COPY src src
    RUN npx tsc

    SAVE ARTIFACT lib /lib AS LOCAL lib

artifacts:
    COPY +install/node_modules server/node_modules
    COPY +install/package-lock.json server/package-lock.json
    COPY +build/lib server/lib
    COPY config/default*.yaml server/config/
    COPY knexfile.js server/
    COPY package.json server/

    SAVE ARTIFACT . publish

docker:
    WORKDIR /app

    ARG REGISTRY='gitea.home'
    ARG IMAGE='silvas/unicast'
    ARG TAG='dev'

    # Install runtime dependencies on the image
    RUN apk add ffmpeg

    # Copy before setting the workdir to the application
    COPY (+artifacts/publish --ALPINE 1) bin

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
    SAVE IMAGE --push --insecure $REGISTRY/$IMAGE:$TAG

docker-all:
    BUILD --platform=linux/amd64 \
          --platform=linux/arm64 \
          +docker

all:
    BUILD +build
    BUILD +docker

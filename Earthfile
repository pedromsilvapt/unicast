VERSION 0.8
FROM node:14.17.3-alpine

WORKDIR /unicast

install-interface:
    ARG DEV

    IF [ "$DEV" == 1 ]
        # Use the Earthfile from a unicast-interface/ folder  that is side-by-side with the unicast/ folder
        COPY ../unicast-interface+pack/*.tgz .
    ELSE
        # Use the Earthfile from the unicast-interface git repository
        GIT CLONE git@gitlab.com:unicast/unicast-interface.git /unicast-interface
        WORKDIR /unicast-interface

        IMPORT gitlab.com/unicast/unicast-interface AS interface
        COPY interface+pack/*.tgz .
    END

    SAVE ARTIFACT ./*.tgz unicast-interface.tgz

install:
    RUN apk add g++ make py3-pip

    COPY --if-exists package.json package-lock.json ./
    RUN npm install
    COPY +install-interface/unicast-interface.tgz .
    RUN npm install unicast-interface.tgz

    SAVE ARTIFACT node_modules /node_modules AS LOCAL node_modules
    SAVE ARTIFACT package-lock.json /package-lock.json AS LOCAL package-lock.json

build:
    FROM +install

    COPY tsconfig.json ./
    COPY src src
    RUN npx tsc

    SAVE ARTIFACT lib /lib AS LOCAL lib

artifacts:
    COPY +install/node_modules node_modules
    COPY +install/package-lock.json package-lock.json
    COPY +build/lib lib
    COPY config/default*.yaml config/
    COPY server.cert server.key knexfile.js ./
    COPY package.json ./
    RUN mkdir storage/

docker:
    FROM +artifacts
    ARG IMAGE='unicast'
    ARG TAG='dev'
    ARG REGISTRY='gitea.local:80/silvas'
    ARG PUSH=''

    # Prepare the Docker Image
    EXPOSE 3030
    VOLUME storage/
    ENTRYPOINT ["node", "/unicast/lib/index.js"]

    SAVE IMAGE $IMAGE:$TAG
    SAVE IMAGE --push --insecure $REGISTRY/$IMAGE:$TAG

docker-multiarch:
    BUILD --platform=linux/amd64 \
          --platform=linux/arm64 \
          +docker

all:
    BUILD +build
    BUILD +docker

VERSION 0.8
FROM node:24-alpine

WORKDIR /app/unicast

install-interface:
    ARG ALPINE
    ARG DEV

    IF [ "$ALPINE" == 1 ]
        FROM node:24-alpine
    ELSE
        FROM node:24
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
        FROM node:24-alpine
        RUN apk add g++ make py3-pip
    ELSE
        FROM node:24
    END

    COPY --if-exists package.json package-lock.json ./
    RUN npm install --legacy-peer-deps
    COPY +install-interface/unicast-interface.tgz .
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
    RUN apk add ffmpeg micro

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

major:
    BUILD +bump --ACTION=major

minor:
    BUILD +bump --ACTION=minor

patch:
    BUILD +bump --ACTION=patch

retag:
    BUILD +bump --ACTION=retag

bump:
    ARG ACTION
    ARG PUSH='1'
    FROM node:24-alpine

    # fig: config-file editor, used to read/set the version in the JSON files
    ARG FIG_VERSION='v3.6.0'
    ARG FIG_URL="https://github.com/diaryx-org/fig/releases/download/cli%2F${FIG_VERSION}/fig-linux-x86_64.tar.gz"
    RUN wget -qO /tmp/fig.tar.gz "${FIG_URL}" \
        && tar -xzf /tmp/fig.tar.gz -C /usr/local/bin \
        && chmod +x /usr/local/bin/fig

    COPY --if-exists package.json package-lock.json ./

    WAIT
        # Read the current version from package.json (no prerelease suffix assumed),
        # bump the requested component (zeroing lower ones) unless ACTION is retag.
        RUN set -e; \
            cur=$(fig get package.json version | tr -d '"'); \
            OIFS=$IFS; IFS=.; set -- $cur; IFS=$OIFS; \
            major=${1:-0}; \
            minor=${2:-0}; \
            patch=${3:-0}; \
            if [ "${ACTION}" != retag ]; then \
                case "${ACTION}" in \
                    major) major=$((major + 1)); minor=0; patch=0 ;; \
                    minor) minor=$((minor + 1)); patch=0 ;; \
                    patch) patch=$((patch + 1)) ;; \
                    *) echo "ACTION must be major, minor, patch or retag" >&2; exit 1 ;; \
                esac; \
            fi; \
            fig set package.json version "${major}.${minor}.${patch}"; \
            if [ -f package-lock.json ]; then \
                fig set package-lock.json version "${major}.${minor}.${patch}"; \
            fi

        SAVE ARTIFACT package.json AS LOCAL package.json
        SAVE ARTIFACT package-lock.json AS LOCAL package-lock.json
    END

    LOCALLY
    RUN new=$(node -p "require('./package.json').version") \
        && if [ "${ACTION}" != retag ]; then \
            git add package.json package-lock.json \
            && git commit -m "chore: bump version to ${new}" -- package.json package-lock.json \
            && git tag -a "v${new}" -m "Release v${new}" HEAD \
            && (if [ "${PUSH}" = "1" ]; then \
                git push && git push origin "v${new}"; \
            fi) \
        else \
            git tag -f -a "v${new}" -m "Release v${new}" HEAD \
            && (if [ "${PUSH}" = "1" ]; then \
                git push --force-with-lease && git push -f origin "v${new}"; \
            fi) \
        fi

all:
    BUILD +build
    BUILD +docker

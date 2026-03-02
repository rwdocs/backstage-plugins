all: typecheck lint test format build

install:
	yarn install

build: install
	yarn workspace @rwdocs/backstage-plugin-rw run build
	yarn workspace @rwdocs/backstage-plugin-rw-backend run build

typecheck: install
	npx tsc --project tsconfig.json

lint: install
	yarn workspace @rwdocs/backstage-plugin-rw run lint
	yarn workspace @rwdocs/backstage-plugin-rw-backend run lint

test: install
	yarn workspace @rwdocs/backstage-plugin-rw-backend run test

format: install
	yarn workspace @rwdocs/backstage-plugin-rw run format
	yarn workspace @rwdocs/backstage-plugin-rw-backend run format

format\:check: install
	yarn workspace @rwdocs/backstage-plugin-rw run format:check
	yarn workspace @rwdocs/backstage-plugin-rw-backend run format:check

clean:
	yarn workspace @rwdocs/backstage-plugin-rw run clean
	yarn workspace @rwdocs/backstage-plugin-rw-backend run clean

all: build lint format

build:
	yarn install
	npx tsc --project tsconfig.json
	yarn workspace @rwdocs/backstage-plugin-rw run build
	yarn workspace @rwdocs/backstage-plugin-rw-backend run build

lint:
	yarn workspace @rwdocs/backstage-plugin-rw run lint
	yarn workspace @rwdocs/backstage-plugin-rw-backend run lint

format:
	yarn workspace @rwdocs/backstage-plugin-rw run format
	yarn workspace @rwdocs/backstage-plugin-rw-backend run format

clean:
	yarn workspace @rwdocs/backstage-plugin-rw run clean
	yarn workspace @rwdocs/backstage-plugin-rw-backend run clean

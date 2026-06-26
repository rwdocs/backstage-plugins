all: typecheck lint test format build

install:
	yarn install

build: install
	yarn workspace @rwdocs/backstage-plugin-rw-common run build
	yarn workspace @rwdocs/backstage-plugin-rw run build
	yarn workspace @rwdocs/backstage-plugin-rw-backend run build
	yarn workspace @rwdocs/backstage-plugin-rw-backend-module-notifications run build
	yarn workspace @rwdocs/backstage-plugin-search-backend-module-rw run build

typecheck: install
	npx tsc --project tsconfig.json

lint: install
	yarn workspace @rwdocs/backstage-plugin-rw-common run lint
	yarn workspace @rwdocs/backstage-plugin-rw run lint
	yarn workspace @rwdocs/backstage-plugin-rw-backend run lint
	yarn workspace @rwdocs/backstage-plugin-rw-backend-module-notifications run lint
	yarn workspace @rwdocs/backstage-plugin-search-backend-module-rw run lint

test: install
	yarn workspace @rwdocs/backstage-plugin-rw-common run test --watchAll=false
	yarn workspace @rwdocs/backstage-plugin-rw run test --watchAll=false
	yarn workspace @rwdocs/backstage-plugin-rw-backend run test --watchAll=false
	yarn workspace @rwdocs/backstage-plugin-rw-backend-module-notifications run test --watchAll=false
	yarn workspace @rwdocs/backstage-plugin-search-backend-module-rw run test --watchAll=false

format: install
	yarn workspace @rwdocs/backstage-plugin-rw-common run format
	yarn workspace @rwdocs/backstage-plugin-rw run format
	yarn workspace @rwdocs/backstage-plugin-rw-backend run format
	yarn workspace @rwdocs/backstage-plugin-rw-backend-module-notifications run format
	yarn workspace @rwdocs/backstage-plugin-search-backend-module-rw run format

format\:check: install
	yarn workspace @rwdocs/backstage-plugin-rw-common run format:check
	yarn workspace @rwdocs/backstage-plugin-rw run format:check
	yarn workspace @rwdocs/backstage-plugin-rw-backend run format:check
	yarn workspace @rwdocs/backstage-plugin-rw-backend-module-notifications run format:check
	yarn workspace @rwdocs/backstage-plugin-search-backend-module-rw run format:check

version:
	@test -n "$(VERSION)" || (echo "Usage: make version VERSION=0.2.0" && exit 1)
	yarn workspace @rwdocs/backstage-plugin-rw-common version $(VERSION)
	yarn workspace @rwdocs/backstage-plugin-rw version $(VERSION)
	yarn workspace @rwdocs/backstage-plugin-rw-backend version $(VERSION)
	yarn workspace @rwdocs/backstage-plugin-rw-backend-module-notifications version $(VERSION)
	yarn workspace @rwdocs/backstage-plugin-search-backend-module-rw version $(VERSION)

clean:
	yarn workspace @rwdocs/backstage-plugin-rw-common run clean
	yarn workspace @rwdocs/backstage-plugin-rw run clean
	yarn workspace @rwdocs/backstage-plugin-rw-backend run clean
	yarn workspace @rwdocs/backstage-plugin-rw-backend-module-notifications run clean
	yarn workspace @rwdocs/backstage-plugin-search-backend-module-rw run clean

dev: install
	yarn workspace backend run start & yarn workspace app run start & wait

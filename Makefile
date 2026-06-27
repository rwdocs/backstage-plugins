all: typecheck lint test format build

install:
	yarn install

build: install
	yarn build

typecheck: install
	yarn typecheck

lint: install
	yarn lint

test: install
	yarn test

format: install
	yarn format

format\:check: install
	yarn format:check

version:
	@test -n "$(VERSION)" || (echo "Usage: make version VERSION=0.2.0" && exit 1)
	yarn workspaces foreach -A --include '@rwdocs/*' version $(VERSION)

clean:
	yarn clean

dev: install
	yarn workspace backend run start & yarn workspace app run start & wait

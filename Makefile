.PHONY: help build run stop restart logs shell clean \
	nats-build nats-run nats-stop nats-restart nats-logs nats-clean \
	ensure-local-env seed-map-data up down up-build ps all-logs clean-local rebuild \
	coolify-up coolify-down coolify-up-build coolify-ps coolify-logs

############################
##@ Database
############################

IMAGE_NAME = bims5-db
DOCKERFILE_PATH = docker/Dockerfile.db
CONTAINER_NAME = bims5-db
DB_NAME = bims5
DB_USER = admin
DB_PASS = admin
DB_PORT = 5432


build: ## build the database image
	docker build -t $(IMAGE_NAME) -f $(DOCKERFILE_PATH) .

conn: ## print the connection string
	@echo "postgresql://$(DB_USER):$(DB_PASS)@localhost:$(DB_PORT)/$(DB_NAME)"

run: ## run the database
	docker run -d \
		--name $(CONTAINER_NAME) \
		-e POSTGRES_DB=$(DB_NAME) \
		-e POSTGRES_USER=$(DB_USER) \
		-e POSTGRES_PASSWORD=$(DB_PASS) \
		-p $(DB_PORT):5432 \
		-v bims5_db_data:/var/lib/postgresql \
		$(IMAGE_NAME)


stop: ## stop the database
	docker stop $(CONTAINER_NAME) || true
	docker rm $(CONTAINER_NAME) || true


restart: stop run ## restart the database


logs: ## view the logs
	docker logs -f $(CONTAINER_NAME)


shell: ## start the database + get access to the psql shell
	docker exec -it $(CONTAINER_NAME) psql -U $(DB_USER) -d $(DB_NAME)


clean: stop ## nukes the database volume (deletes all data)
	docker volume rm bims5_db_data || true

############################
##@ NATS JetStream
############################

NATS_IMAGE = bims5-nats
NATS_DOCKERFILE = docker/Dockerfile.nats
NATS_CONTAINER = bims5-nats
NATS_PORT = 4222
NATS_MONITOR_PORT = 8222

FRONTEND_ENV = trafficjam-fe/.env
FRONTEND_ENV_EXAMPLE = trafficjam-fe/.env.example
COMPOSE_LOCAL = docker compose -f docker-compose.local.yml


nats-build: ## build the NATS JetStream image
	docker build -t $(NATS_IMAGE) -f $(NATS_DOCKERFILE) .

nats-run: ## run NATS JetStream
	docker run -d \
		--name $(NATS_CONTAINER) \
		-p $(NATS_PORT):4222 \
		-p $(NATS_MONITOR_PORT):8222 \
		-v bims5_nats_data:/data/jetstream \
		$(NATS_IMAGE)

nats-stop: ## stop NATS JetStream
	docker stop $(NATS_CONTAINER) || true
	docker rm $(NATS_CONTAINER) || true

nats-restart: nats-stop nats-run ## restart NATS JetStream

nats-logs: ## view NATS logs
	docker logs -f $(NATS_CONTAINER)

nats-clean: nats-stop ## nukes the NATS data volume
	docker volume rm bims5_nats_data || true


############################
##@ Docker Compose — Local Dev
############################

ensure-local-env: ## create missing local env files from examples
	@if [ ! -f $(FRONTEND_ENV) ]; then \
		cp $(FRONTEND_ENV_EXAMPLE) $(FRONTEND_ENV); \
		echo "Created $(FRONTEND_ENV) from $(FRONTEND_ENV_EXAMPLE). Update VITE_MAPBOX_TOKEN for map rendering."; \
	fi
	@token=$$(awk -F= '/^VITE_MAPBOX_TOKEN=/{print substr($$0, index($$0,"=")+1)}' $(FRONTEND_ENV)); \
	if [ -z "$$token" ]; then token="YOUR_MAPBOX_TOKEN_HERE"; fi; \
	{ \
		printf 'VITE_MAPBOX_TOKEN=%s\n' "$$token"; \
		printf 'VITE_MAP_DATA_SERVICE_URL=http://localhost:8000\n'; \
		printf 'VITE_TRAFFICJAM_BE_URL=http://localhost:8001\n'; \
	} > $(FRONTEND_ENV); \
	echo "Ensured $(FRONTEND_ENV) uses local Docker services for rebuild."

seed-map-data: ## load Belfast OSM map data into local PostGIS
	$(COMPOSE_LOCAL) up -d db
	$(COMPOSE_LOCAL) build map-data
	$(COMPOSE_LOCAL) run --rm map-data python load_belfast.py

up: ensure-local-env ## start all local services
	$(COMPOSE_LOCAL) up -d

up-build: ensure-local-env ## build and start all local services
	$(COMPOSE_LOCAL) up -d --build

down: ## stop all local services
	$(COMPOSE_LOCAL) down

ps: ## show status of local services
	$(COMPOSE_LOCAL) ps

all-logs: ## tail logs from local services
	$(COMPOSE_LOCAL) logs -f

clean-local: ## stop local services and delete all volumes (wipes db)
	$(COMPOSE_LOCAL) down -v

rebuild: ensure-local-env ## stop, rebuild all images, and restart local services
	$(COMPOSE_LOCAL) down
	-docker stop $(NATS_CONTAINER)
	-docker rm $(NATS_CONTAINER)
	$(MAKE) seed-map-data
	$(COMPOSE_LOCAL) up -d --build

############################
##@ Docker Compose — Coolify
############################

coolify-up: ## start all Coolify services
	docker compose up -d

coolify-up-build: ## build and start all Coolify services
	docker compose up -d --build

coolify-down: ## stop all Coolify services
	docker compose down

coolify-ps: ## show status of Coolify services
	docker compose ps

coolify-logs: ## tail logs from Coolify services
	docker compose logs -f

############################
##@ Help
############################

help: ## Display this help message
	@echo ""
	@echo "Usage: make <target>"
	@echo ""
	@grep -E '(##@|##)' $(MAKEFILE_LIST) | grep -v grep | while read -r line; do \
		if [[ $$line =~ ^##@ ]]; then \
			echo ""; \
			echo "$${line####@ }"; \
		elif [[ $$line =~ ^[a-zA-Z_-]+: ]]; then \
			target=$$(echo "$$line" | cut -d':' -f1); \
			comment=$$(echo "$$line" | sed -n 's/.*## *//p'); \
			if [ -n "$$comment" ]; then \
				printf "    \033[32m%-20s\033[0m %s\n" "$$target" "$$comment"; \
			fi \
		fi \
	done

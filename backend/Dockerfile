# Etapa 1: Build de dependencias de Composer y Node
FROM php:8.3-cli-alpine AS builder

RUN apk add --no-cache nodejs npm git unzip libzip-dev \
    && docker-php-ext-install pdo pdo_mysql

COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

WORKDIR /app
COPY . .

RUN composer install --no-dev --optimize-autoloader --no-interaction
RUN npm install && npm run build

# Etapa 2: Entorno de ejecución en producción
FROM php:8.3-cli-alpine

RUN apk add --no-cache bash curl libzip-dev \
    && docker-php-ext-install pdo pdo_mysql opcache

WORKDIR /app
COPY --from=builder /app /app

EXPOSE 8000

CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000"]
# Production image: PHP 8.3 + Apache serving server/public, with the planning app, Trip Log and workbook bundled.
FROM php:8.3-apache
RUN apt-get update && apt-get install -y --no-install-recommends libzip-dev unzip && rm -rf /var/lib/apt/lists/* \
 && docker-php-ext-install pdo_mysql zip opcache && a2enmod rewrite headers
COPY docker/apache.conf /etc/apache2/sites-available/000-default.conf
COPY docker/php.ini /usr/local/etc/php/conf.d/app.ini
WORKDIR /var/www/app
COPY . /var/www/app
RUN mkdir -p server/data/backups && chown -R www-data:www-data server/data
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 80
ENTRYPOINT ["/entrypoint.sh"]
CMD ["apache2-foreground"]

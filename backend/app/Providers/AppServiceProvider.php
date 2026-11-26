<?php

namespace App\Providers;

use App\Services\GoogleClientTokenVerifier;
use App\Services\GoogleTokenVerifier;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->bind(GoogleTokenVerifier::class, function () {
            return new GoogleClientTokenVerifier((string) config('services.google.client_id'));
        });
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        //
    }
}

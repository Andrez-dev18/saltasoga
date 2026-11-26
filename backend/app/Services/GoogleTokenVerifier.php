<?php

namespace App\Services;

interface GoogleTokenVerifier
{
    /**
     * Verifica un ID token de Google Identity Services.
     *
     * @return array<string, mixed>|null Payload del token o null si no es válido.
     */
    public function verify(string $idToken): ?array;
}

<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_register_and_receive_token(): void
    {
        $response = $this->postJson('/api/register', [
            'name' => 'Sergio Test',
            'email' => 'sergio@example.com',
            'password' => 'secret1234',
            'password_confirmation' => 'secret1234',
        ]);

        $response->assertStatus(201)
            ->assertJsonStructure([
                'status',
                'message',
                'user' => ['id', 'name', 'email'],
                'token',
            ]);

        $this->assertDatabaseHas('users', [
            'email' => 'sergio@example.com',
        ]);
    }

    public function test_register_rejects_duplicate_email(): void
    {
        User::factory()->create(['email' => 'dup@example.com']);

        $response = $this->postJson('/api/register', [
            'name' => 'Otro',
            'email' => 'dup@example.com',
            'password' => 'secret1234',
            'password_confirmation' => 'secret1234',
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['email']);
    }

    public function test_user_can_login_and_fetch_profile_and_logout(): void
    {
        User::factory()->create([
            'email' => 'login@example.com',
            'password' => 'secret1234',
        ]);

        $loginRes = $this->postJson('/api/login', [
            'email' => 'login@example.com',
            'password' => 'secret1234',
        ]);

        $loginRes->assertStatus(200)
            ->assertJsonStructure(['token', 'user']);

        $token = $loginRes->json('token');

        $this->withToken($token)
            ->getJson('/api/user')
            ->assertStatus(200)
            ->assertJsonPath('user.email', 'login@example.com');

        $this->withToken($token)
            ->postJson('/api/logout')
            ->assertStatus(200);

        $this->assertDatabaseCount('personal_access_tokens', 0);
    }

    public function test_login_rejects_invalid_credentials(): void
    {
        User::factory()->create([
            'email' => 'fail@example.com',
            'password' => 'secret1234',
        ]);

        $this->postJson('/api/login', [
            'email' => 'fail@example.com',
            'password' => 'wrongpass',
        ])->assertStatus(401);
    }

    public function test_user_endpoint_requires_authentication(): void
    {
        $this->getJson('/api/user')->assertStatus(401);
    }
}

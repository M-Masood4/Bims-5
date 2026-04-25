package com.bims5;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Main Spring Boot application entry point for BIMS 5 simulation engine.
 *
 * This application provides a REST API for running MATSim simulations,
 * streaming events, and managing simulation lifecycle.
 */
@SpringBootApplication
public class Application {

    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}

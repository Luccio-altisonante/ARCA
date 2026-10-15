#include "sillabe.hpp"

#include <iostream>
#include <string>

// Protocollo offline: una grafia UTF-8 e un conteggio per riga.
int main() {
    std::string parola;
    while (std::getline(std::cin, parola)) {
        std::cout << anagrammi::conta_sillabe(parola) << '\n';
    }
    return std::cin.bad() || !std::cout ? 1 : 0;
}

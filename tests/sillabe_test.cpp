#include "../core/sillabe.hpp"

#include <cassert>
#include <iostream>
#include <string>
#include <string_view>

int main() {
    using anagrammi::conta_sillabe;

    assert(conta_sillabe("casa") == 2);
    assert(conta_sillabe("fatto") == 2);
    assert(conta_sillabe("tavolo") == 3);
    assert(conta_sillabe("caramella") == 4);
    assert(conta_sillabe("anagramma") == 4);
    assert(conta_sillabe("parolastranissima") == 7);

    assert(conta_sillabe("buono") == 2);
    assert(conta_sillabe("pieno") == 2);
    assert(conta_sillabe("miei") == 1);
    assert(conta_sillabe("tuoi") == 1);
    assert(conta_sillabe("suoi") == 1);
    assert(conta_sillabe("questo") == 2);
    assert(conta_sillabe("scienza") == 2);
    assert(conta_sillabe("cielo") == 2);
    assert(conta_sillabe("guida") == 2);

    assert(conta_sillabe("poeta") == 3);
    assert(conta_sillabe("teatro") == 3);
    assert(conta_sillabe("paese") == 3);
    assert(conta_sillabe("aereo") == 4);
    assert(conta_sillabe("noia") == 2);
    assert(conta_sillabe("fornaio") == 3);
    assert(conta_sillabe("aiuola") == 3);

    assert(conta_sillabe(u8"pa\u00f9ra") == 3);
    assert(conta_sillabe(u8"bug\u00eca") == 3);
    assert(conta_sillabe(u8"v\u00eca") == 2);
    assert(conta_sillabe(u8"z\u00eco") == 2);
    assert(conta_sillabe(u8"farmac\u00eca") == 4);
    assert(conta_sillabe(u8"pa\u00fara") == 3);
    assert(conta_sillabe(u8"pa\u00fbra") == 3);
    assert(conta_sillabe(u8"v\u00eda") == 2);
    assert(conta_sillabe(u8"v\u00eea") == 2);
    assert(conta_sillabe(u8"po\u00e9ta") == 3);
    assert(conta_sillabe(u8"citt\u00e0") == 2);
    assert(conta_sillabe(u8"perch\u00e9") == 2);
    assert(conta_sillabe(u8"andr\u00f2") == 2);
    assert(conta_sillabe(u8"pi\u00f9") == 1);
    assert(conta_sillabe(u8"\u00ec\u00f9") == 2);

    assert(conta_sillabe("CARAMELLA") == 4);
    assert(conta_sillabe("ScIeNzA") == 2);
    assert(conta_sillabe(u8"PA\u00d9RA") == 3);
    assert(conta_sillabe(u8"BUG\u00cdA") == 3);
    assert(conta_sillabe(u8"V\u00cea") == 2);
    assert(conta_sillabe(u8"paU\u0300ra") == 3);
    assert(conta_sillabe(u8"bugi\u0300a") == 3);
    assert(conta_sillabe(u8"vi\u0301a") == 2);
    assert(conta_sillabe(u8"vi\u0302a") == 2);
    assert(conta_sillabe(u8"citta\u0300") == 2);
    assert(conta_sillabe(u8"\u00e0\u00e1\u00e2\u00e8\u00e9\u00ea\u00f2\u00f3\u00f4") == 9);

    assert(conta_sillabe("") == 0);
    assert(conta_sillabe("xyz") == 0);
    assert(conta_sillabe("rhythm") == 0);
    assert(conta_sillabe("123-?!") == 0);
    assert(conta_sillabe("l'amico") == 3);
    assert(conta_sillabe(u8"l\u2019amico") == 3);
    assert(conta_sillabe("a-e") == 2);
    assert(conta_sillabe("a1e") == 2);
    assert(conta_sillabe("(casa!)") == 2);
    assert(conta_sillabe("  casa\t\n") == 2);
    assert(conta_sillabe(u8"\u00a0casa\u00a0") == 2);
    assert(conta_sillabe("fatto oggi") == 0);
    assert(conta_sillabe("fatto\toggi") == 0);
    assert(conta_sillabe(u8"fatto\u00a0oggi") == 0);
    assert(conta_sillabe(u8"fatto\u2003oggi") == 0);
    assert(conta_sillabe(" \t\n") == 0);

    const std::string malformato{ 'a', static_cast<char>(0xff), 'e' };
    assert(conta_sillabe(malformato) == 2);
    assert(conta_sillabe(std::string(1, static_cast<char>(0xff))) == 0);
    assert(conta_sillabe(std::string("a\0e", 3)) == 2);
    const std::string parola = u8"BUGI\u0300A";
    const std::string originale = parola;
    assert(conta_sillabe(parola) == 3);
    assert(parola == originale);
    assert(conta_sillabe(std::string_view("casaXYZ", 4)) == 2);

    std::cout << "Test sillabe superati.\n";
    return 0;
}

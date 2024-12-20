#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <time.h>

void foo(int* tab, size_t size)
{
  /* Affect a random number to prevent compiler optimization */
  /*size_t i;
  for(i = 0; i < size; ++i) {
    tab[i] = rand();
    }*/
  tab[size-1] = rand();

  sleep(1);
}

int main()
{
  /* Units */
  const size_t KILO = 1024;
  const size_t MEGA = 1024 * KILO;
  /* const size_t BLOCK = 10 * MEGA; */
  size_t block = 0;
  int * tab;
  const int MAX = 300;
  const int MIN = 50;

  /* Init random seed */
  srand(time(NULL));  

  block = (rand() % (MAX - MIN) + MAX) * MEGA;
  
  /* Allocate */
  tab = malloc(block * sizeof(int));

  foo(tab, block); /* do some operation */

  /* free */
  free(tab);
  
  return 0;
}

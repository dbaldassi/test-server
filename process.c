#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <time.h>
#include <signal.h>

char * tab = NULL;

void sig_hdl(int sig)
{
  if(sig == SIGUSR1) {
    printf("Exiting\n");
    free(tab);
    exit(0);
  }
}

void foo(char* local, size_t size)
{
  /* Affect a random number to prevent compiler optimization */
  size_t i;
  for(i = 0; i < size; i++) {
    local[i] = rand();
  }
  // tab[size-1] = rand();

  // sleep(1);
}

int main()
{
  /* Units */
  const size_t KILO = 1024;
  const size_t MEGA = 1024 * KILO;
  /* const size_t BLOCK = 10 * MEGA; */
  size_t block = 0;
  const int MAX = 100;
  const int MIN = 25;

  signal(SIGUSR1, sig_hdl);

  /* Init random seed */
  srand(time(NULL));  

  block = (rand() % (MAX - MIN) + MAX) * MEGA;
  // block = MAX * MEGA;
  
  /* Allocate */
  tab = malloc(block);

  foo(tab, block); /* do some operation */

  getchar();

  free(tab);
  
  return 0;
}
